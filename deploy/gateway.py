#!/usr/bin/python3
"""Root-owned forced command. Archives contain only the dependency-free server."""
import os, sys, re, json, tarfile, tempfile, hashlib, subprocess, pathlib, fcntl, shutil, time
BASE = pathlib.Path('/opt/guangyi-workspace')
SHA = r'[0-9a-f]{40}'
def run(*args):
    return subprocess.check_output(args, stderr=subprocess.STDOUT, timeout=120, cwd=BASE).decode().strip()
def revision():
    return (BASE / 'current/REVISION').read_text().strip()
def verify(expected):
    for attempt in range(15):
        try:
            assert json.loads(run('curl','-fsS','--max-time','8','http://127.0.0.1:8087/health')) == {'status':'ok'}
            origin='https://workspace.kdfz.com.cn'
            assert json.loads(run('curl','-fsS','--max-time','8',origin+'/health')) == {'status':'ok'}
            assert run('curl','-sS','--max-time','8','-o','/dev/null','-w','%{http_code}',origin+'/api/native/v1/workspace') == '401'
            if expected != 'legacy': assert json.loads(run('curl','-fsS','--max-time','8',origin+'/deploy-revision.json'))['revision']==expected
            return
        except Exception:
            if attempt == 14: raise RuntimeError('deployment verification failed')
            time.sleep(1)
def switch(target):
    temporary=BASE/'current.next'
    if temporary.exists() or temporary.is_symlink(): temporary.unlink()
    temporary.symlink_to(target)
    os.replace(temporary, BASE/'current')
    run('systemctl','restart','guangyi-workspace.service')
def activate(target):
    previous=(BASE/'current').resolve()
    try:
        switch(target)
        verify((target/'REVISION').read_text().strip())
    except Exception:
        switch(previous)
        verify((previous/'REVISION').read_text().strip())
        raise
    (BASE/'deploy-channel/previous').write_text(str(previous)+'\n')
def main():
    command=os.environ.get('SSH_ORIGINAL_COMMAND','')
    lock=open('/run/lock/guangyi-workspace-deploy.lock','w')
    fcntl.flock(lock,fcntl.LOCK_EX)
    if command=='status':
        print(json.dumps({'revision':revision(),'active':run('systemctl','is-active','guangyi-workspace.service')})); return
    rollback=re.fullmatch('rollback ('+SHA+')',command)
    if rollback:
        target=BASE/'releases'/rollback[1]
        assert target.is_dir() and not target.is_symlink()
        assert (target/'REVISION').read_text().strip()==rollback[1]
        activate(target); print(json.dumps({'revision':revision()})); return
    match=re.fullmatch('deploy ('+SHA+') ([0-9a-f]{64}) ([0-9]{1,8})',command)
    if not match: raise ValueError('unsupported command')
    commit,digest,size=match.groups(); size=int(size)
    if not 0<size<=8*1024*1024: raise ValueError('archive size')
    with tempfile.TemporaryDirectory(prefix='incoming-',dir=BASE/'deploy-channel') as scratch:
        pathlib.Path(scratch).chmod(0o755)
        archive=pathlib.Path(scratch)/'release.tar.gz'
        data=sys.stdin.buffer.read(size+1)
        if len(data)!=size or hashlib.sha256(data).hexdigest()!=digest: raise ValueError('archive integrity')
        archive.write_bytes(data)
        with tarfile.open(archive,'r:gz') as tar:
            members=tar.getmembers()
            allowed={'server.mjs','server.test.mjs','REVISION'}
            if len(members)!=3 or {m.name for m in members}!=allowed: raise ValueError('archive manifest')
            if any(not m.isfile() or m.size>2*1024*1024 for m in members): raise ValueError('archive type or size')
            stage=pathlib.Path(scratch)/'source'; stage.mkdir()
            for member in members:
                (stage/member.name).write_bytes(tar.extractfile(member).read())
        if (stage/'REVISION').read_text().strip()!=commit: raise ValueError('revision mismatch')
        for file in stage.iterdir(): file.chmod(0o644)
        stage.chmod(0o755)
        # Tests use an in-memory DB and must never run with administrator privileges.
        run('runuser','-u','guangyi-workspace','--',str(BASE/'runtime/bin/node'),'--test',str(stage/'server.test.mjs'))
        target=BASE/'releases'/commit
        if target.exists():
            if any((target/name).read_bytes()!=(stage/name).read_bytes() for name in allowed): raise ValueError('immutable release differs')
        else: shutil.copytree(stage,target)
        activate(target)
        print(json.dumps({'revision':revision(),'deployed':True}))
if __name__=='__main__':
    try: main()
    except Exception as error:
        print('GUANGYI_DEPLOY_FAILED: '+type(error).__name__,file=sys.stderr)
        if isinstance(error, subprocess.CalledProcessError): print(error.output.decode()[:4000],file=sys.stderr); sys.exit(1)
