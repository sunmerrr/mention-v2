import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {strict as assert} from 'node:assert';
const root=await mkdtemp('.dev/tmp/compose-check-');
try{
 await writeFile(`${root}/compose.yml`,await readFile('apps/deploy/docker-compose.yml'));
 await writeFile(`${root}/.env`,await readFile('apps/deploy/.env.example'));
 const result=spawnSync('docker',['compose','-f',`${root}/compose.yml`,'config','--format','json'],{encoding:'utf8'});
 if(result.status!==0)throw Error(result.stderr);
 const config=JSON.parse(result.stdout),services=config.services;
 for(const role of ['api','worker','ingest','migrate','backup-volume']){
  assert.equal(services[role].image,services.api.image);
  assert(!services[role].container_name);
 }
 assert.equal(services.migrate.environment.APP_ROLE,'migrate');
 assert.equal(services.worker.depends_on['backup-volume'].condition,'service_completed_successfully');
 assert.equal(services['backup-volume'].network_mode,'none');
 assert.equal(services['backup-volume'].volumes.length,1);
 assert.equal(services['backup-volume'].volumes[0].target,'/app/backup');
 assert.equal(services.api.depends_on.migrate.condition,'service_completed_successfully');
 for(const role of ['ingest','worker']){
  assert.equal(services[role].volumes[0].target,'/run/mention/connection');
  assert.equal(services[role].volumes[0].read_only,true);
  assert.equal(services[role].volumes[0].bind.create_host_path,false);
  assert.equal(services[role].environment.KAKAO_COLLECTOR_TOKEN_FILE,'/run/mention/connection/collector.token');
 }
 assert.equal(services.ingest.environment.KAKAO_EVENTS_ENABLED,'0');
 assert(!services.api.volumes?.length);assert(!services.postgres.ports?.length);
 console.log('Server Compose checked: one app image, migration gate, private PostgreSQL and dedicated directory socket mount. No services started.');
}finally{await rm(root,{recursive:true,force:true});}
