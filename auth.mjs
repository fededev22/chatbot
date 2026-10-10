import {randomBytes,randomInt,createHash,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const derive=promisify(scrypt),hash=value=>createHash('sha256').update(String(value)).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
const day=24*3600000;
export const sessionPolicy=Object.freeze({idleMs:30*day,absoluteMs:90*day});
let hashing=0;
async function passwordKey(password,salt){if(hashing>=2)throw authError('Hay varios accesos en curso. Intentá nuevamente en unos segundos.',429);hashing++;try{return await derive(password,salt,64,{N:131072,r:8,p:1,maxmem:256*1024*1024});}finally{hashing--;}}
export function authError(message,status=400){return Object.assign(Error(message),{status});}
export function accountFields(data){
  const email=String(data.email||'').trim().toLowerCase(),phone=String(data.phone||'').trim().replace(/[ ()-]/g,'');
  if(email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw authError('Ingresá un correo válido.');
  if(!/^\+[1-9]\d{7,14}$/.test(phone))throw authError('Ingresá el teléfono con código de país, por ejemplo +549…');
  return {email,phone};
}
async function passwordHash(password,salt=randomBytes(16).toString('hex')){
  if(typeof password!=='string'||password.length<15||password.length>128)throw authError('La contraseña debe tener entre 15 y 128 caracteres. Podés usar una frase.');
  const value=await passwordKey(password,salt);
  return {salt,value:value.toString('hex')};
}
const safeAccount=a=>({id:a.id,email:a.email,phone:a.phone,role:a.role,disabled:!!a.disabled});
export function createAuth(db,{now=Date.now}={}){
  db.exec(`CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,phone TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS auth_sessions(token_hash TEXT PRIMARY KEY,account_id TEXT UNIQUE NOT NULL,csrf TEXT NOT NULL,created INTEGER NOT NULL,active INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_invites(token_hash TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,phone TEXT UNIQUE NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,until INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_captchas(id TEXT PRIMARY KEY,answer_hash TEXT NOT NULL,ip_hash TEXT NOT NULL,expires INTEGER NOT NULL);`);
  const count=()=>db.prepare('SELECT count(*) AS n FROM accounts').get().n;
  function clean(){db.prepare('DELETE FROM auth_invites WHERE expires<=?').run(now());db.prepare('DELETE FROM auth_captchas WHERE expires<=?').run(now());db.prepare('DELETE FROM auth_attempts WHERE until<=?').run(now());db.prepare('DELETE FROM auth_sessions WHERE created<=? OR active<=?').run(now()-sessionPolicy.absoluteMs,now()-sessionPolicy.idleMs);}
  function transaction(work){db.exec('BEGIN IMMEDIATE');try{const result=work();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
  function attemptKeys(ip,email){return [`ip:${hash(ip)}`,`account:${hash(String(email||'').trim().toLowerCase())}`];}
  function guard(ip,email){clean();for(const key of attemptKeys(ip,email)){const row=db.prepare('SELECT count FROM auth_attempts WHERE key=?').get(key);if(row?.count>=8)throw authError('Demasiados intentos. Esperá 15 minutos antes de volver a intentar.',429);}}
  function failure(ip,email){for(const key of attemptKeys(ip,email))db.prepare('INSERT INTO auth_attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,now()+15*60000);}
  function captcha(ip){clean();const id=secret(),letters='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',answer=Array.from({length:6},()=>letters[randomInt(letters.length)]).join('');
    db.prepare('INSERT INTO auth_captchas VALUES(?,?,?,?)').run(id,hash(answer),hash(ip),now()+5*60000);
    const text=[...answer].map((letter,i)=>`<text x="${24+i*29}" y="${39+randomInt(-4,5)}" transform="rotate(${randomInt(-13,14)} ${24+i*29} 35)">${letter}</text>`).join('');
    const lines=Array.from({length:7},()=>`<path d="M ${randomInt(210)} ${randomInt(60)} L ${randomInt(210)} ${randomInt(60)}"/>`).join('');
    return {id,svg:`<svg xmlns="http://www.w3.org/2000/svg" width="210" height="60" viewBox="0 0 210 60"><rect width="210" height="60" fill="#edf3e9"/><g stroke="#829785" opacity=".5">${lines}</g><g fill="#224f40" font-family="monospace" font-size="27" font-weight="bold">${text}</g></svg>`};
  }
  function checkCaptcha(data,ip){const row=db.prepare('SELECT * FROM auth_captchas WHERE id=?').get(String(data.captchaId||''));db.prepare('DELETE FROM auth_captchas WHERE id=?').run(String(data.captchaId||''));if(!row||row.expires<=now()||row.ip_hash!==hash(ip)||row.answer_hash!==hash(String(data.captchaAnswer||'').trim().toUpperCase()))throw authError('El código de seguridad es incorrecto o venció. Probá con el nuevo código.');}
  function session(account){const token=secret(),csrf=secret();db.prepare('DELETE FROM auth_sessions WHERE account_id=?').run(account.id);db.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?,?)').run(hash(token),account.id,csrf,now(),now());return {token,...current(token)};}
  function current(token){clean();if(typeof token!=='string'||! /^[A-Za-z0-9_-]{43}$/.test(token))return null;const row=db.prepare('SELECT a.*,s.csrf,s.created,s.active FROM auth_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND a.disabled=0').get(hash(token));return row?{user:safeAccount(row),csrf:row.csrf,expiresAt:Math.min(row.created+sessionPolicy.absoluteMs,row.active+sessionPolicy.idleMs)}:null;}
  function activity(token){if(!current(token))return null;db.prepare('UPDATE auth_sessions SET active=? WHERE token_hash=?').run(now(),hash(token));return current(token);}
  async function verify(account,password){const salt=account?.salt||'00000000000000000000000000000000';const candidate=typeof password==='string'&&password.length<=128?password:'invalid';const value=await passwordKey(candidate,salt);return !!account&&timingSafeEqual(value,Buffer.from(account.password_hash,'hex'));}
  function insert(fields,password,role){const id=secret();try{db.prepare('INSERT INTO accounts(id,email,phone,salt,password_hash,role) VALUES(?,?,?,?,?,?)').run(id,fields.email,fields.phone,password.salt,password.value,role);}catch{throw authError('Ese correo o teléfono ya tiene una cuenta.');}return db.prepare('SELECT * FROM accounts WHERE id=?').get(id);}
  async function setup(data,ip){guard(ip,data.email);try{checkCaptcha(data,ip);const fields=accountFields(data),password=await passwordHash(data.password);return transaction(()=>{if(count())throw authError('La cuenta administradora ya fue creada.',409);return session(insert(fields,password,'owner'));});}catch(error){failure(ip,data.email);throw error;}}
  async function login(data,ip){guard(ip,data.email);try{checkCaptcha(data,ip);const email=String(data.email||'').trim().toLowerCase(),account=db.prepare('SELECT * FROM accounts WHERE email=?').get(email);const verified=await verify(account,data.password),fresh=account&&db.prepare('SELECT * FROM accounts WHERE id=?').get(account.id);if(!verified||!fresh||fresh.disabled||fresh.password_hash!==account.password_hash)throw authError('Correo o contraseña incorrectos.',401);db.prepare('DELETE FROM auth_attempts WHERE key=?').run(attemptKeys(ip,email)[1]);return session(fresh);}catch(error){failure(ip,data.email);throw error;}}
  async function changePassword(token,data,ip){
    const access=current(token);if(!access)throw authError('Ingresá con tu cuenta.',401);
    const email=access.user.email;guard(ip,email);
    try{
      const account=db.prepare('SELECT * FROM accounts WHERE id=?').get(access.user.id);
      if(!await verify(account,data.currentPassword))throw authError('La contraseña actual es incorrecta.',400);
      if(data.password===data.currentPassword)throw authError('Elegí una contraseña diferente de la actual.');
      const password=await passwordHash(data.password);
      return transaction(()=>{
        const fresh=db.prepare('SELECT * FROM accounts WHERE id=?').get(account.id);
        if(!current(token)||fresh.disabled||fresh.password_hash!==account.password_hash)throw authError('La sesión cambió. Ingresá nuevamente.',401);
        db.prepare('UPDATE accounts SET salt=?,password_hash=? WHERE id=?').run(password.salt,password.value,account.id);
        db.prepare('DELETE FROM auth_attempts WHERE key=?').run(attemptKeys(ip,email)[1]);
        return session(fresh);
      });
    }catch(error){failure(ip,email);throw error;}
  }
  function owner(user){if(user.role!=='owner')throw authError('Esta acción requiere la cuenta administradora.',403);}
  function list(user){owner(user);clean();return {limit:3,accounts:db.prepare('SELECT id,email,phone,role,disabled FROM accounts').all().map(a=>({...safeAccount(a),connected:!!db.prepare('SELECT 1 FROM auth_sessions WHERE account_id=?').get(a.id)})),invites:db.prepare('SELECT email,phone,expires FROM auth_invites').all()};}
  function invite(user,data){owner(user);const fields=accountFields(data);return transaction(()=>{clean();if(count()+db.prepare('SELECT count(*) AS n FROM auth_invites').get().n>=3)throw authError('El panel permite como máximo 3 cuentas, incluyendo invitaciones pendientes.',409);if(db.prepare('SELECT 1 FROM accounts WHERE email=? OR phone=?').get(fields.email,fields.phone)||db.prepare('SELECT 1 FROM auth_invites WHERE email=? OR phone=?').get(fields.email,fields.phone))throw authError('Ese correo o teléfono ya tiene una cuenta o invitación.');const token=secret();db.prepare('INSERT INTO auth_invites VALUES(?,?,?,?)').run(hash(token),fields.email,fields.phone,now()+24*3600000);return {token,...fields};});}
  function invitation(token){clean();const row=db.prepare('SELECT email,phone,expires FROM auth_invites WHERE token_hash=?').get(hash(token));if(!row)throw authError('La invitación venció o no es válida.',404);return row;}
  async function accept(data,ip){guard(ip,'invite');try{checkCaptcha(data,ip);invitation(data.invite);const password=await passwordHash(data.password);return transaction(()=>{const fields=invitation(data.invite);if(count()>=3)throw authError('Ya hay 3 cuentas.',409);const account=insert(fields,password,'staff');db.prepare('DELETE FROM auth_invites WHERE token_hash=?').run(hash(data.invite));return session(account);});}catch(error){failure(ip,'invite');throw error;}}
  function revokeInvite(user,email){owner(user);db.prepare('DELETE FROM auth_invites WHERE email=?').run(String(email));}
  function status(user,id,disabled){owner(user);if(id===user.id)throw authError('No podés bloquear tu propia cuenta.');if(typeof disabled!=='boolean')throw authError('Estado inválido.');const result=db.prepare("UPDATE accounts SET disabled=? WHERE id=? AND role='staff'").run(Number(disabled),String(id));if(!result.changes)throw authError('Cuenta no encontrada.',404);db.prepare('DELETE FROM auth_sessions WHERE account_id=?').run(String(id));}
  return {count,captcha,setup,login,current,changePassword,list,invite,invitation,accept,revokeInvite,status,logout(token){db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(hash(token));},activity,clean};
}
