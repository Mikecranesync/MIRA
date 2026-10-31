import sys,re,html
t=open(sys.argv[1],encoding='utf8',errors='ignore').read()
title=re.search(r'<title>(.*?)</title>',t,re.S); print("TITLE:",html.unescape(title.group(1)) if title else "")
for m in re.finditer(r'data-author="([^"]*)".*?<div class="bbWrapper">(.*?)</div>\s*</div>\s*</article>',t,re.S):
  body=re.sub(r'<[^>]+>',' ',m.group(2)); body=html.unescape(re.sub(r'\s+',' ',body)).strip()
  print("---",m.group(1),":",body[:1500])
