// Runs in Chrome's isolated content-script world. No page message bridge or external messaging.
(async()=>{
  if (!location.pathname.endsWith('/apply')) {
    if (location.pathname.endsWith('/thanks') && /application (has been )?(successfully )?(submitted|received)|thank you for applying/i.test(document.body.innerText)) {
      await chrome.runtime.sendMessage({type:'result',success:true,note:'Employer displayed submission confirmation'});
    }
    return;
  }
  let started=false;
  const send=async message=>{const result=await chrome.runtime.sendMessage(message);if(result.error)throw new Error(result.error);return result;};
  try{
    const {profile}=await send({type:'ready'});started=true;
    if(document.querySelector('iframe[src*="captcha"], [class*="captcha"], [data-sitekey]'))throw new Error('CAPTCHA requires manual application');
    let attached=false;
    for(const el of document.querySelectorAll('input,textarea,select')){
      if(['hidden','submit','button'].includes(el.type)||!el.getClientRects().length&&el.type!=='file')continue;
      if(el.type==='file'){
        if(el.name!=='resume')throw new Error('Additional document requested');
        const bytes=Uint8Array.from(atob(profile.resume.data),c=>c.charCodeAt(0));
        const transfer=new DataTransfer();transfer.items.add(new File([bytes],profile.resume.name,{type:profile.resume.type}));el.files=transfer.files;el.dispatchEvent(new Event('change',{bubbles:true}));attached=true;continue;
      }
      if(['checkbox','radio'].includes(el.type))throw new Error('Consent or choice question needs manual review');
      const label=(el.labels?.[0]?.textContent||el.closest('.application-question')?.querySelector('.application-label')?.textContent||el.getAttribute('aria-label')||'').trim();
      const base={name:profile.name,email:profile.email,phone:profile.phone,org:profile.currentCompany};
      const answer=Object.hasOwn(base,el.name)?base[el.name]:profile.answers[label];
      if(answer===undefined||answer==='')throw new Error(`Unanswered field: ${label||el.name||'unknown'}`);
      if(el.tagName==='SELECT'){const option=[...el.options].find(x=>x.textContent===answer);if(!option)throw new Error(`Answer unavailable: ${label}`);el.value=option.value;}
      else {const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,String(answer));}
      el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
    }
    if(!attached||document.querySelector('input:invalid,textarea:invalid,select:invalid'))throw new Error('Required fields or resume incomplete');
    const buttons=[...document.querySelectorAll('button,input[type=submit]')].filter(x=>/^submit application$/i.test((x.textContent||x.value).trim()));
    if(buttons.length!==1)throw new Error('Standard submit control not found');
    await send({type:'submitting'});buttons[0].click();
    let remaining=40;
    const timer=setInterval(async()=>{
      const confirmed=/application (has been )?(successfully )?(submitted|received)|thank you for applying/i.test(document.body.innerText);
      if(confirmed||--remaining<=0){clearInterval(timer);try{await send({type:'result',success:confirmed,note:confirmed?'Employer displayed submission confirmation':'No confirmation; check employer before retrying'});}catch{/* navigation may have interrupted the page */}}
    },500);
  }catch(error){if(started)try{await chrome.runtime.sendMessage({type:'result',success:false,note:error.message});}catch{/* Keep durable reservation on interruption. */}}
})();
