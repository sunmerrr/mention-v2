import { lstat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Build arguments without shell interpolation or changing the owner's socket. */
export function tunnelArguments(env) {
  const target = env.MENTION_SSH_TARGET;
  const local = env.MENTION_LOCAL_OWNER_SOCKET;
  const remote = env.MENTION_REMOTE_OWNER_SOCKET;
  if (!target || !/^[a-zA-Z0-9_][a-zA-Z0-9_.@:-]*$/.test(target)) throw new Error('SSH_TARGET_REQUIRED');
  for (const value of [local, remote]) {
    if (!value || !value.startsWith('/') || /[\s:\0]/.test(value)) throw new Error('ABSOLUTE_SOCKET_PATH_REQUIRED');
  }
  if (!remote.endsWith('/connection.sock')) throw new Error('DEDICATED_REMOTE_SOCKET_REQUIRED');
  return ['-NT', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'ControlMaster=no', '-R', `${remote}:${local}`, target];
}
async function main() {
  const args=tunnelArguments(process.env);
  if(process.argv.includes('--dry-run')){process.stdout.write(JSON.stringify({executable:'ssh',args})+'\n');return;}
  if(!process.argv.includes('--run'))throw new Error('EXPLICIT_RUN_OR_DRY_RUN_REQUIRED');
  if(!(await lstat(process.env.MENTION_LOCAL_OWNER_SOCKET)).isSocket())throw new Error('LOCAL_OWNER_SOCKET_NOT_PRESENT');
  const child=spawn('ssh',args,{stdio:'inherit'});
  child.once('error',()=>{process.exitCode=1;});
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>child.kill(signal));
  child.once('exit',code=>{process.exitCode=code??1;});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});
