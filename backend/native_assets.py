import asyncio,os
from pathlib import Path
PROJECT=Path(__file__).resolve().parents[1]
BLENDER=Path(os.getenv('BLENDER_BIN',str(PROJECT/'.tools/blender/Blender.app/Contents/MacOS/Blender')))
LOCK=asyncio.Semaphore(1)
