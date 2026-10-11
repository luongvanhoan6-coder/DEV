document.querySelectorAll('.nav a').forEach(a=>a.addEventListener('click',()=>document.body.classList.remove('nav-open')));
const f=document.getElementById('form'),msg=document.getElementById('msg');
f.addEventListener('submit',async e=>{
  e.preventDefault();
  const d=Object.fromEntries(new FormData(f));
  if(!d.name.trim()||!/^[0-9+\s().-]{8,15}$/.test(d.phone.trim())){msg.className='err';msg.textContent='Vui lòng nhập họ tên và số điện thoại hợp lệ.';return}
  const b=f.querySelector('button');b.disabled=true;msg.className='';msg.textContent='Đang gửi...';
  try{
    const r=await fetch('/api/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
    if(!r.ok)throw 0;
    f.reset();msg.className='ok';msg.textContent='Cảm ơn bạn! Ong Vàng đã nhận thông tin và sẽ liên hệ sớm.';
  }catch{msg.className='err';msg.textContent='Gửi chưa thành công, vui lòng thử lại hoặc liên hệ trực tiếp.'}
  b.disabled=false;
});
