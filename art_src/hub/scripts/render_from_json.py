#!/usr/bin/env python3
# python scripts/render_from_json.py --scenario developed
import argparse, json, os
from PIL import Image
root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(root,'maps/hub_placements.json'),encoding='utf-8') as f: cfg=json.load(f)
a=argparse.ArgumentParser();a.add_argument('--scenario',choices=list(cfg['scenarios']),default='developed');a.add_argument('--output',default=None)
args=a.parse_args()
sc=cfg['scenarios'][args.scenario]
base=Image.open(os.path.join(root,cfg['background']['native'])).convert('RGBA')
if sc.get('markers'):
 marker=Image.open(os.path.join(root,'markers/build_available.png')).convert('RGBA').resize((53,53),Image.Resampling.NEAREST)
 occupied={cfg['placements'][bid]['slot_id'] for bid in sc['buildings']}
 for sl in cfg['plots']:
  if sl['id'] in occupied or sl['kind']=='riverbank': continue
  x1,y1,x2,y2=sl['bbox'];cx=(x1+x2)//2;cy=(y1+y2)//2
  base.alpha_composite(marker,(cx-26,cy-26))
for bid in sorted(sc['buildings'],key=lambda bid:cfg['placements'][bid]['z_order']):
 entry=cfg['placements'][bid]
 spr=Image.open(os.path.join(root,entry['file'])).convert('RGBA')
 spr=spr.resize((entry['width'],entry['height']),Image.Resampling.BOX)
 base.alpha_composite(spr,(entry['x'],entry['y']))
path=args.output or os.path.join(root,f'previews/re_rendered_{args.scenario}.png')
base.save(path)
print(path)
