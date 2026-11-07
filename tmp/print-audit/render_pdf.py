from pathlib import Path
from pdf2image import convert_from_path
from PIL import Image, ImageDraw
import concurrent.futures
root=Path('tmp/print-audit'); target=root/'raster'; target.mkdir(exist_ok=True)
def render(p):
    pages=convert_from_path(str(p),dpi=85,fmt='png',output_folder=str(target),output_file=p.stem,paths_only=True,thread_count=1)
    return [(p.stem,i+1,path) for i,path in enumerate(pages)]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    pages=[x for group in pool.map(render,sorted(root.glob('*.pdf'))) for x in group]
for start in range(0,len(pages),4):
    sheet=Image.new('RGB',(1500,2100),'#dddddd');d=ImageDraw.Draw(sheet)
    for index,(name,num,path) in enumerate(pages[start:start+4]):
        im=Image.open(path);im.thumbnail((730,1000));x=(index%2)*750;y=(index//2)*1050
        sheet.paste(im,(x,y+25));d.text((x+8,y+5),f'{name} page {num}',fill='black')
    sheet.save(target/f'contact-{start//4+1:02d}.jpg')
print(f'Rendered {len(pages)} pages, {(len(pages)+3)//4} sheets')
