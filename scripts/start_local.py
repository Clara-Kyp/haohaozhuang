"""启动本地陈设与3D装修站；复用已在监听的服务，不终止已有进程。"""
import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
args = parser.parse_args()
logs = ROOT / '.runtime/logs'
logs.mkdir(parents=True, exist_ok=True)
env = dict(os.environ)
node_paths = sorted((Path.home() / '.nvm/versions/node').glob('*/bin'), key=lambda p: tuple(int(n) for n in p.parent.name.lstrip('v').split('.') if n.isdigit()))
if node_paths:
    env['PATH'] = str(node_paths[-1]) + os.pathsep + env.get('PATH', '')
state_file = ROOT / '.runtime/local-services.json'
try:
    pids = json.loads(state_file.read_text())
except (OSError, ValueError):
    pids = {}

def recorded_alive(name):
    item = pids.get(name, {})
    if not isinstance(item, dict) or not item.get('pid'):
        return False
    check = subprocess.run(['ps', '-p', str(item['pid']), '-o', 'command='], capture_output=True, text=True)
    return check.returncode == 0 and item.get('marker', '!missing!') in check.stdout

def listening(port):
    with socket.socket() as sock:
        sock.settimeout(.4)
        return sock.connect_ex(('127.0.0.1', port)) == 0

def launch(name, command, cwd=ROOT, port=None):
    if port and listening(port):
        print(f'{name}: 已有服务，复用端口 {port}')
        return
    if recorded_alive(name):
        print(f'{name}: 当前启动进程仍在加载，复用 PID {pids[name]["pid"]}')
        return
    if not Path(command[0]).exists() and not shutil.which(command[0], path=env['PATH']):
        raise SystemExit(f'{name}: 缺少程序 {command[0]}')
    with (logs / f'{name}.log').open('ab') as log:
        proc = subprocess.Popen([str(v) for v in command], cwd=cwd, env=env,
                                stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    marker = {'api':'backend.main:app','web':'npm'}.get(name,name)
    pids[name] = {'pid':proc.pid,'marker':marker}
    state_file.write_text(json.dumps(pids))
    print(f'{name}: 已启动 PID {proc.pid}，日志 {logs / (name + ".log")}')

launch('api', [ROOT/'.venv/bin/uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', '8000'], port=8000)
launch('web', ['npm', 'run', 'dev', '--', '--host', '127.0.0.1'], cwd=ROOT/'app', port=5173)
state_file.write_text(json.dumps(pids))
print('访问 http://127.0.0.1:5173/ 。陈设提案使用当前配置的模型服务，3D 编辑不依赖图片生成服务。')
