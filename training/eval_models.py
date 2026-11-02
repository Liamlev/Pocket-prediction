import glob, random, numpy as np, onnxruntime as ort, time
from PIL import Image
from ultralytics import YOLO
D='ext/TeogopK_Playing-Cards-Object-Detection/data/'
real_names=['10h','2h','3h','4h','5h','6h','7h','8h','9h','Ah','Jh','Kh','Qh']
syn_names=['10c','10d','10h','10s','2c','2d','2h','2s','3c','3d','3h','3s','4c','4d','4h','4s','5c','5d','5h','5s','6c','6d','6h','6s','7c','7d','7h','7s','8c','8d','8h','8s','9c','9d','9h','9s','Ac','Ad','Ah','As','Jc','Jd','Jh','Js','Kc','Kd','Kh','Ks','Qc','Qd','Qh','Qs']
def gt(img,names):
    lab=img.replace('/images/','/labels/').rsplit('.',1)[0]+'.txt'
    return {names[int(l.split()[0])].upper() for l in open(lab) if l.strip()}
sets={'real':[(f,gt(f,real_names)) for f in sorted(glob.glob(D+'real_dataset/*/images/*'))]}
random.seed(1); syn=random.sample(sorted(glob.glob(D+'synthetic_dataset/test/images/*')),150)
sets['synthetic']=[(f,gt(f,syn_names)) for f in syn]
H=ort.InferenceSession('ext/Hamza-Asif-ai_Playing-Card-Detection-YOLOv8/best.onnx')
HN=eval(H.get_modelmeta().custom_metadata_map['names'])
def hamza(f,eff):
    im=Image.open(f).convert('RGB'); W,Hh=im.size; sc=eff/max(W,Hh)
    c=Image.new('RGB',(640,640),(114,114,114)); c.paste(im.resize((int(W*sc),int(Hh*sc))),(int((640-W*sc)/2),int((640-Hh*sc)/2)))
    o=H.run(None,{'images':np.asarray(c,dtype=np.float32).transpose(2,0,1)[None]/255})[0][0]
    conf=o[4:].max(0); cls=o[4:].argmax(0); m=conf>0.45
    return {HN[int(c)].upper() for c in cls[m]}
N=YOLO('ext/noorkhokhar99_Playing-Cards-Detection-with-YoloV8/yolov8s_playing_cards.pt')
def noor(f,sz):
    r=N.predict(f,imgsz=sz,conf=0.45,verbose=False)[0]
    return {N.names[int(c)].upper() for c in r.boxes.cls.tolist()}
cfgs=[('hamza eff640',lambda f:hamza(f,640)),('hamza eff416',lambda f:hamza(f,416)),('hamza eff320',lambda f:hamza(f,320)),
      ('noor 640',lambda f:noor(f,640)),('noor 480',lambda f:noor(f,480)),('noor 416',lambda f:noor(f,416)),('noor 320',lambda f:noor(f,320))]
for sname,items in sets.items():
    for name,fn in cfgs:
        tp=fp=fn_=0; t=time.time()
        for f,g in items:
            p=fn(f); tp+=len(p&g); fp+=len(p-g); fn_+=len(g-p)
        print(f'{sname:9s} {name:13s} recall {tp/(tp+fn_):.2f}  precision {tp/max(1,tp+fp):.2f}  ({(time.time()-t)/len(items)*1000:.0f} ms/img)')
