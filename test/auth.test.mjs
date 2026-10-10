import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createAuth,accountFields,sessionPolicy} from '../auth.mjs';
const password='Una frase privada de prueba 2026',ip='127.0.0.1';
function fixture(){let time=Date.now();const db=new DatabaseSync(':memory:'),auth=createAuth(db,{now:()=>time});return {db,auth,advance(ms){time+=ms;},close(){db.close();}};}
function challenge(auth,address=ip){const c=auth.captcha(address);return {captchaId:c.id,captchaAnswer:[...c.svg.matchAll(/<text[^>]*>([^<]+)<\/text>/g)].map(m=>m[1]).join('')};}
const fields=(n=1)=>({email:`persona${n}@example.test`,phone:`+549111234500${n}`,password});
test('contraseña con sal y scrypt, primera cuenta única y sin filtración de hashes',async()=>{const f=fixture();try{const result=await f.auth.setup({...fields(),...challenge(f.auth)},ip);assert.equal(result.user.role,'owner');assert.equal(result.user.email,fields().email);assert.ok(!JSON.stringify(result).includes(password));assert.ok(!('password_hash' in result.user));const stored=f.db.prepare('SELECT * FROM accounts').get();assert.notEqual(stored.password_hash,password);assert.equal(stored.password_hash.length,128);assert.equal(stored.salt.length,32);await assert.rejects(f.auth.setup({...fields(2),...challenge(f.auth)},ip),/ya fue creada/);assert.equal(f.auth.count(),1);}finally{f.close();}});
test('máximo tres cuentas incluyendo invitaciones; aceptar una sola vez y privilegios del administrador',async()=>{const f=fixture();try{const owner=(await f.auth.setup({...fields(),...challenge(f.auth)},ip)).user;const second=f.auth.invite(owner,fields(2)),third=f.auth.invite(owner,fields(3));assert.throws(()=>f.auth.invite(owner,fields(4)),/máximo 3/);const staff=await f.auth.accept({invite:second.token,password,...challenge(f.auth)},ip);assert.equal(staff.user.role,'staff');assert.throws(()=>f.auth.list(staff.user),/administradora/);assert.throws(()=>f.auth.invite(staff.user,fields(4)),/administradora/);await assert.rejects(f.auth.accept({invite:second.token,password,...challenge(f.auth)},ip),/no es válida/);await f.auth.accept({invite:third.token,password,...challenge(f.auth)},ip);assert.equal(f.auth.count(),3);assert.throws(()=>f.auth.invite(owner,fields(4)),/máximo 3/);assert.equal(f.auth.list(owner).accounts.length,3);}finally{f.close();}});
test('sesión persistente: 30 días sin uso, renovación, máximo 90 días y revocación',async()=>{const f=fixture(),day=86400000;try{
  const first=await f.auth.setup({...fields(),...challenge(f.auth)},ip),next=await f.auth.login({...fields(),...challenge(f.auth)},ip);
  assert.equal(f.auth.current(first.token),null);assert.ok(f.auth.current(next.token));
  f.advance(2*day);assert.ok(f.auth.current(next.token),'no cierra tras media hora, una noche o doce horas');
  f.advance(27*day);const renewed=f.auth.activity(next.token);assert.ok(renewed);assert.equal(renewed.expiresAt-next.expiresAt,29*day);
  const restarted=createAuth(f.db,{now:()=>renewed.expiresAt-day});assert.ok(restarted.current(next.token),'sobrevive al reinicio');
  f.advance(29*day);assert.ok(f.auth.current(next.token));f.advance(day);assert.equal(f.auth.current(next.token),null);
  assert.equal(f.auth.activity(next.token),null,'no revive una sesión vencida');
  const last=await f.auth.login({...fields(),...challenge(f.auth)},ip);
  for(let i=0;i<3;i++){f.advance(29*day);assert.ok(f.auth.activity(last.token));}
  assert.equal(f.auth.current(last.token).expiresAt,last.expiresAt-sessionPolicy.idleMs+sessionPolicy.absoluteMs);
  f.advance(3*day);assert.equal(f.auth.current(last.token),null,'el límite absoluto vence aunque haya interacción');
  const logout=await f.auth.login({...fields(),...challenge(f.auth)},ip);f.auth.logout(logout.token);assert.equal(f.auth.activity(logout.token),null);
}finally{f.close();}});
test('cambiar contraseña exige la actual, rota sesión y CSRF y rechaza la clave anterior',async()=>{const f=fixture();try{
  const first=await f.auth.setup({...fields(),...challenge(f.auth)},ip),password2='Otra frase de acceso para pruebas';
  await assert.rejects(f.auth.changePassword(first.token,{currentPassword:'incorrecta',password:password2},ip),/actual es incorrecta/);
  await assert.rejects(f.auth.changePassword(first.token,{currentPassword:password,password:'corta'},ip),/15 y 128/);
  assert.ok(f.auth.current(first.token));
  const next=await f.auth.changePassword(first.token,{currentPassword:password,password:password2},ip);
  assert.equal(f.auth.current(first.token),null);assert.notEqual(first.csrf,next.csrf);assert.ok(f.auth.current(next.token));
  await assert.rejects(f.auth.login({...fields(),...challenge(f.auth)},ip),/incorrectos/);
  assert.ok((await f.auth.login({...fields(),password:password2,...challenge(f.auth)},ip)).token);
}finally{f.close();}});
test('bloquear una cuenta mientras se verifica su contraseña impide crear otra sesión',async()=>{const f=fixture();try{
  const owner=(await f.auth.setup({...fields(),...challenge(f.auth)},ip)).user,inv=f.auth.invite(owner,fields(2));
  const staff=await f.auth.accept({invite:inv.token,password,...challenge(f.auth)},ip);
  const signingIn=f.auth.login({...fields(2),...challenge(f.auth)},ip);
  f.auth.status(owner,staff.user.id,true);await assert.rejects(signingIn,/incorrectos/);assert.equal(f.auth.current(staff.token),null);
}finally{f.close();}});
test('bloquear cuenta cierra su sesión y no permite bloquear al administrador',async()=>{const f=fixture();try{const owner=(await f.auth.setup({...fields(),...challenge(f.auth)},ip)).user,invite=f.auth.invite(owner,fields(2)),staff=await f.auth.accept({invite:invite.token,password,...challenge(f.auth)},ip);f.auth.status(owner,staff.user.id,true);assert.equal(f.auth.current(staff.token),null);await assert.rejects(f.auth.login({...fields(2),...challenge(f.auth)},ip),/incorrectos/);assert.throws(()=>f.auth.status(owner,owner.id,true),/propia cuenta/);f.auth.status(owner,staff.user.id,false);assert.ok((await f.auth.login({...fields(2),...challenge(f.auth)},ip)).token);}finally{f.close();}});
test('CAPTCHA de un uso, ligado al cliente, vencimiento y bloqueo de intentos persistente',async()=>{const f=fixture();try{const c=challenge(f.auth);await assert.rejects(f.auth.setup({...fields(),...c},'otra-ip'),/código de seguridad/);await assert.rejects(f.auth.setup({...fields(),...c},ip),/código de seguridad/);const expired=challenge(f.auth);f.advance(5*60000);await assert.rejects(f.auth.setup({...fields(),...expired},ip),/código de seguridad/);for(let i=0;i<5;i++)await assert.rejects(f.auth.login({...fields(),captchaId:'inexistente',captchaAnswer:'AAAAAA'},ip),/código de seguridad/);await assert.rejects(f.auth.login({...fields(),...challenge(f.auth)},ip),/Demasiados intentos/);const restarted=createAuth(f.db,{now:()=>Date.now()});await assert.rejects(restarted.login({...fields(),...challenge(restarted)},ip),/Demasiados intentos/);f.advance(16*60000);assert.ok((await f.auth.setup({...fields(),...challenge(f.auth)},ip)).token);}finally{f.close();}});
test('validación de contactos y contraseña; cancelar y vencer invitación libera cupo',async()=>{const f=fixture();try{assert.throws(()=>accountFields({email:'no-email',phone:'+5491112345678'}),/correo válido/);assert.throws(()=>accountFields({email:'a@example.test',phone:'111234'}),/código de país/);await assert.rejects(f.auth.setup({...fields(),password:'corta',...challenge(f.auth)},ip),/15 y 128/);const owner=(await f.auth.setup({...fields(),...challenge(f.auth)},ip)).user;f.auth.invite(owner,fields(2));f.auth.revokeInvite(owner,fields(2).email);const invite=f.auth.invite(owner,fields(2));f.advance(25*3600000);assert.throws(()=>f.auth.invitation(invite.token),/venció/);assert.ok(f.auth.invite(owner,fields(3)));}finally{f.close();}});
