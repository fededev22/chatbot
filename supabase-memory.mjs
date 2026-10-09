// Supabase persists contact/appointment memory; SQLite remains the single worker's
// transactional agenda and durable retry queue. Never transfer chat or auth data.
export function createSupabaseMemory(engine,env,{request=fetch,clock=()=>new Date()}={}) {
  const url=env.SUPABASE_URL?.replace(/\/$/,''),key=env.SUPABASE_SECRET_KEY,clinic=env.SUPABASE_CLINIC_ID||'clinica-principal';
  if(!url&&!key)return {enabled:false,bootstrap:async()=>{},refresh:async()=>{},flush:async()=>{},status:()=>({enabled:false})};
  if(!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url||'')||!key||!/^[-\w.]{20,1000}$/.test(key)||!/^[a-z0-9_-]{1,80}$/.test(clinic))throw Error('Revisá la configuración privada de Supabase.');
  engine.db.exec(`CREATE TABLE IF NOT EXISTS cloud_memory_jobs(phone TEXT PRIMARY KEY,version INTEGER NOT NULL DEFAULT 1,attempts INTEGER NOT NULL DEFAULT 0,next_try INTEGER NOT NULL DEFAULT 0,error TEXT);
    CREATE TABLE IF NOT EXISTS cloud_memory_control(id INTEGER PRIMARY KEY CHECK(id=1),importing INTEGER NOT NULL DEFAULT 0,target TEXT);
    INSERT OR IGNORE INTO cloud_memory_control(id) VALUES(1);
    CREATE TRIGGER IF NOT EXISTS cloud_contact_insert AFTER INSERT ON contacts WHEN (SELECT importing FROM cloud_memory_control WHERE id=1)=0 BEGIN
      INSERT INTO cloud_memory_jobs(phone) VALUES(new.phone) ON CONFLICT(phone) DO UPDATE SET version=version+1,next_try=0; END;
    CREATE TRIGGER IF NOT EXISTS cloud_contact_update AFTER UPDATE ON contacts WHEN (SELECT importing FROM cloud_memory_control WHERE id=1)=0 BEGIN
      INSERT INTO cloud_memory_jobs(phone) VALUES(new.phone) ON CONFLICT(phone) DO UPDATE SET version=version+1,next_try=0; END;
    CREATE TRIGGER IF NOT EXISTS cloud_appointment_insert AFTER INSERT ON appointments WHEN new.session LIKE 'wa:%' AND (SELECT importing FROM cloud_memory_control WHERE id=1)=0 BEGIN
      INSERT INTO cloud_memory_jobs(phone) VALUES(substr(new.session,4)) ON CONFLICT(phone) DO UPDATE SET version=version+1,next_try=0; END;
    CREATE TRIGGER IF NOT EXISTS cloud_appointment_update AFTER UPDATE ON appointments WHEN new.session LIKE 'wa:%' AND (SELECT importing FROM cloud_memory_control WHERE id=1)=0 BEGIN
      INSERT INTO cloud_memory_jobs(phone) VALUES(substr(new.session,4)) ON CONFLICT(phone) DO UPDATE SET version=version+1,next_try=0; END;`);
  const target=`${url}/${clinic}`,previous=engine.query('SELECT target FROM cloud_memory_control WHERE id=1')[0].target;
  if(previous&&previous!==target)throw Error('La memoria ya está vinculada a otro destino. Revisá la migración antes de cambiarlo.');
  if(!previous){engine.db.exec('BEGIN IMMEDIATE');try{engine.run('UPDATE cloud_memory_control SET target=? WHERE id=1',target);engine.db.exec('INSERT OR IGNORE INTO cloud_memory_jobs(phone) SELECT phone FROM contacts');engine.db.exec('COMMIT');}catch(e){engine.db.exec('ROLLBACK');throw e;}}
  let flushing=null,lastError=null,lastSync=null;
  const headers={apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`})};
  async function api(path,options={}) {
    try{
      const response=await request(url+'/rest/v1/'+path,{...options,headers:{...headers,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(10000),redirect:'error'});
      if(!response.ok)throw Error('supabase_http_'+Number(response.status));
      return options.method==='POST'?null:await response.json();
    }catch(e){throw Error(/^supabase_http_\d+$/.test(e.message)?e.message:'supabase_unavailable');}
  }
  function snapshot(phone) {
    const contact=engine.query('SELECT * FROM contacts WHERE phone=?',phone)[0];
    const appointments=engine.query('SELECT * FROM appointments WHERE session=?','wa:'+phone).map(a=>({id:a.id,phone,name:a.name,service:a.service,professional:a.professional,start:a.start,end:a.end,busy_end:a.busy_end,status:a.status,consent:!!a.consent,attendance:!!a.attendance}));
    return {p_clinic_id:clinic,p_contact:contact,p_appointments:appointments};
  }
  async function drain() {
    for(const job of engine.query('SELECT * FROM cloud_memory_jobs WHERE next_try<=? ORDER BY phone LIMIT 50',clock().getTime())){
      const body=snapshot(job.phone);
      if(!body.p_contact){engine.run('DELETE FROM cloud_memory_jobs WHERE phone=? AND version=?',job.phone,job.version);continue;}
      try{
        await api('rpc/dental_save_memory',{method:'POST',body:JSON.stringify(body)});
        engine.run('DELETE FROM cloud_memory_jobs WHERE phone=? AND version=?',job.phone,job.version);
        lastSync=clock().toISOString();lastError=null;
      }catch(e){lastError=e.message;engine.run('UPDATE cloud_memory_jobs SET attempts=attempts+1,next_try=?,error=? WHERE phone=? AND version=?',clock().getTime()+Math.min(300000,5000*2**Math.min(job.attempts,6)),lastError,job.phone,job.version);break;}
    }
  }
  function flush(){if(flushing)return flushing;flushing=drain().finally(()=>{flushing=null;});return flushing;}
  async function rows(table,phone) {
    const result=[];
    for(let offset=0;;offset+=500){
      const params=new URLSearchParams({clinic_id:'eq.'+clinic,select:'*',order:table==='dental_contacts'?'phone':'id',limit:'500',offset:String(offset)});
      if(phone)params.set('phone','eq.'+phone);
      const page=await api(table+'?'+params);if(!Array.isArray(page))throw Error('supabase_invalid_data');result.push(...page);if(page.length<500)break;
    }
    return result;
  }
  function merge(contacts,appointments) {
    const validDate=s=>typeof s==='string'&&!isNaN(Date.parse(s));
    for(const c of contacts)if(c.clinic_id!==clinic||!/^\d{10,15}$/.test(c.phone)||c.name!==null&&(typeof c.name!=='string'||c.name.length>100)||!['first_seen','last_seen','updated'].every(k=>validDate(c[k])))throw Error('supabase_invalid_data');
    for(const a of appointments)if(a.clinic_id!==clinic||!/^\d{10,15}$/.test(a.phone)||!/^[a-f0-9]{8}$/.test(a.id)||!['confirmed','cancelled','rescheduled'].includes(a.status)||!['start','end','busy_end'].every(k=>validDate(a[k]))||typeof a.name!=='string'||a.name.length>100||typeof a.service!=='string'||typeof a.professional!=='string')throw Error('supabase_invalid_data');
    engine.db.exec('BEGIN IMMEDIATE');
    try{
      engine.run('UPDATE cloud_memory_control SET importing=1 WHERE id=1');
      const dirty=new Set(engine.query('SELECT phone FROM cloud_memory_jobs').map(j=>j.phone));
      for(const c of contacts){
        if(dirty.has(c.phone))continue;
        const iso=k=>new Date(c[k]).toISOString();
        engine.run('INSERT INTO contacts VALUES(?,?,?,?,?) ON CONFLICT(phone) DO UPDATE SET name=coalesce(excluded.name,contacts.name),first_seen=min(contacts.first_seen,excluded.first_seen),last_seen=max(contacts.last_seen,excluded.last_seen),updated=max(contacts.updated,excluded.updated)',c.phone,c.name,iso('first_seen'),iso('last_seen'),iso('updated'));
        engine.run('INSERT OR IGNORE INTO sessions VALUES(?,?,?)','wa:'+c.phone,'{}',iso('last_seen'));
      }
      for(const a of appointments){
        if(dirty.has(a.phone))continue;
        const own=engine.query('SELECT session FROM appointments WHERE id=?',a.id)[0];if(own&&own.session!=='wa:'+a.phone)throw Error('supabase_owner_mismatch');
        if(!engine.contact('wa:'+a.phone))throw Error('supabase_invalid_data');
        engine.run(`INSERT INTO appointments(id,session,name,phone,service,professional,start,end,busy_end,status,consent,attendance) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name,phone=excluded.phone,service=excluded.service,professional=excluded.professional,start=excluded.start,end=excluded.end,busy_end=excluded.busy_end,status=excluded.status,consent=excluded.consent,attendance=excluded.attendance`,a.id,'wa:'+a.phone,a.name,a.phone,a.service,a.professional,new Date(a.start).toISOString(),new Date(a.end).toISOString(),new Date(a.busy_end).toISOString(),a.status,a.consent?1:0,a.attendance?1:0);
      }
      engine.run('UPDATE cloud_memory_control SET importing=0 WHERE id=1');engine.db.exec('COMMIT');
    }catch(e){engine.db.exec('ROLLBACK');throw e;}
  }
  async function pull(phone){const contacts=await rows('dental_contacts',phone),appointments=await rows('dental_appointments',phone);merge(contacts,appointments);lastSync=clock().toISOString();lastError=null;}
  async function bootstrap(){await flush();try{await pull();}catch(e){lastError=e.message;throw Error('No se pudo iniciar la memoria de Supabase: '+lastError);}}
  async function refresh(session){if(!/^wa:\d{10,15}$/.test(session))return;await flush();try{await pull(session.slice(3));}catch(e){lastError=e.message;}}
  return {enabled:true,bootstrap,refresh,flush,status:()=>({enabled:true,pending:engine.query('SELECT count(*) n FROM cloud_memory_jobs')[0].n,lastSync,error:lastError})};
}
