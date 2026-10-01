#!/usr/bin/env python3
"""启动搭子云（grok）：把 bind mount 路径换成外层 Docker 看到的路径。

用法：restore.py [compose 参数...]（默认 up -d）。已加进 /workspace/recovery/start-all.sh。
"""
import os, subprocess, sys
from pathlib import Path
sys.path.insert(0, '/workspace/recovery')
from docker_api import workspace_root

root = Path(__file__).resolve().parent
if not (root / '.runtime' / 'secrets.env').is_file():
    raise SystemExit(f'REFUSED: {root}/.runtime/secrets.env 不存在（模型 Key 只放这里）')
(root / 'data').mkdir(exist_ok=True)
args = sys.argv[1:] or ['up', '-d']
env = dict(os.environ, DOCKER_HOST='tcp://127.0.0.1:2375', DOCKER_CONFIG='/workspace/suge/.tools',
           DAZI_ROOT=workspace_root().removesuffix('/workspace') + str(root))
cmd = ['/workspace/suge/.tools/docker', 'compose', '-p', 'dazi-cloud', '-f', str(root / 'compose.yml'), *args]
raise SystemExit(subprocess.call(cmd, env=env, cwd=root))
