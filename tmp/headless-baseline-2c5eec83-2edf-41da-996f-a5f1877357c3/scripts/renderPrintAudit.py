from pathlib import Path
import argparse, concurrent.futures, json, subprocess, sys
from pdf2image import convert_from_path
from PIL import Image, ImageDraw
parser=argparse.ArgumentParser(description='Raster QA evidence; never declares print readiness automatically.')
parser.add_argument('--root',default='tmp/print-audit')
parser.add_argument('--docx-renderer',help='Path to render_docx.py; attempts every generated DOCX and records failures.')
args=parser.parse_args();root=Path(args.root);target=root/'raster';target.mkdir(exist_ok=True)
def render(p):
    pages=convert_from_path(str(p),dpi=100,fmt='png',output_folder=str(target),output_file=p.stem,paths_only=True,thread_count=1)
    return [(p.stem,i+1,path) for i,path in enumerate(pages)]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    pages=[x for group in pool.map(render,sorted(root.glob('*.pdf'))) for x in group]
for start in range(0,len(pages),4):
    sheet=Image.new('RGB',(1500,2100),'#dddddd');d=ImageDraw.Draw(sheet)
    for index,(name,num,path) in enumerate(pages[start:start+4]):
        im=Image.open(path);im.thumbnail((730,1000));x=(index%2)*750;y=(index//2)*1050
        sheet.paste(im,(x,y+25));d.text((x+8,y+5),f'{name} page {num}',fill='black')
    sheet.save(target/f'contact-{start//4+1:02d}.jpg')
print(f'Rendered {len(pages)} PDF pages, {(len(pages)+3)//4} review sheets')
if args.docx_renderer:
    def docx(p):
        try:
            r=subprocess.run([sys.executable,args.docx_renderer,str(p),'--output_dir',str(root/'docx-render'/p.stem),'--emit_pdf'],capture_output=True,text=True,timeout=60)
            return {'file':p.name,'status':'RENDERED_REQUIRES_VISUAL_REVIEW' if r.returncode==0 else 'RENDER_BLOCKED','exitCode':r.returncode,'detail':(r.stdout+r.stderr)[-1800:]}
        except Exception as e:return {'file':p.name,'status':'RENDER_BLOCKED','detail':str(e)}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(docx,sorted(root.glob('*.docx'))))
    (root/'docx-render-results.json').write_text(json.dumps(results,indent=2))
    print(f'DOCX attempted: {len(results)}; rendered: {sum(r["status"].startswith("RENDERED") for r in results)}')
