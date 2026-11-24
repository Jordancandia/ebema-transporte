const c=l=>String(l??"").replace(/[&<>"']/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[e]),b=l=>c(l).replace(/\b\d{6,}\b/g,e=>`<span class="sv-cf-doc">${e}</span>`).replace(/\n/g,"<br>"),g=[[/^¿?\s*(eliminar|borrar|vaciar)/i,"Eliminar","peligro","delete"],[/^¿?\s*excluir/i,"Excluir","peligro","visibility_off"],[/^¿?\s*anular/i,"Anular","peligro","block"],[/^¿?\s*quitar/i,"Quitar","peligro","undo"],[/^¿?\s*descartar|sin guardar/i,"Descartar","peligro","warning"],[/^¿?\s*incluir/i,"Incluir","normal","playlist_add"],[/^¿?\s*marcar/i,"Confirmar","normal","task_alt"],[/^¿?\s*asignar/i,"Asignar","normal","auto_awesome"],[/^¿?\s*georreferenciar/i,"Georreferenciar","normal","location_on"]];function x(l,e={}){const r=String(l??""),s=r.indexOf(`

`),p=(s>=0?r.slice(0,s):r).trim(),f=s>=0?r.slice(s+2).trim():"",d=g.find(([o])=>o.test(p))||[null,"Continuar","normal","help"],y=e.aceptar||d[1],a=e.tono||d[2],m=e.icono||d[3],u=document.activeElement;return new Promise(o=>{const i=document.createElement("div");i.className="sv-cf-bg",i.innerHTML=`<div class="sv-cf" role="alertdialog" aria-modal="true" aria-labelledby="sv-cf-t">
        <div class="sv-cf-b">
          <div class="sv-cf-ic ${a==="peligro"?"is-bad":""}"><span class="material-symbols-outlined">${c(m)}</span></div>
          <div style="min-width:0">
            <div class="sv-cf-t" id="sv-cf-t">${b(p)}</div>
            ${f?`<div class="sv-cf-d">${b(f)}</div>`:""}
          </div>
        </div>
        <div class="sv-cf-f">
          <button type="button" class="sv-btn" data-cf="0">${c(e.cancelar||"Cancelar")}</button>
          <button type="button" class="sv-btn-p" data-cf="1">${c(y)}</button>
        </div></div>`;const v=n=>{if(document.removeEventListener("keydown",t,!0),i.classList.remove("is-on"),setTimeout(()=>i.remove(),120),u&&u.focus)try{u.focus()}catch{}o(n)},t=n=>{n.key==="Escape"?(n.preventDefault(),n.stopPropagation(),v(!1)):n.key==="Enter"&&(n.preventDefault(),n.stopPropagation(),v(!0))};i.addEventListener("click",n=>{n.target===i&&v(!1)}),i.querySelectorAll("[data-cf]").forEach(n=>n.addEventListener("click",()=>v(n.dataset.cf==="1"))),document.addEventListener("keydown",t,!0),document.body.appendChild(i),requestAnimationFrame(()=>i.classList.add("is-on")),i.querySelector('[data-cf="1"]').focus()})}function $(l,e={}){const r=String(l??""),s=r.indexOf(`

`),p=(s>=0?r.slice(0,s):r).trim(),f=s>=0?r.slice(s+2).trim():"",d=document.activeElement;return new Promise(y=>{const a=document.createElement("div");a.className="sv-cf-bg",a.innerHTML=`<div class="sv-cf" role="dialog" aria-modal="true" aria-labelledby="sv-cf-t">
        <div class="sv-cf-b">
          <div class="sv-cf-ic"><span class="material-symbols-outlined">${c(e.icono||"edit")}</span></div>
          <div style="min-width:0;flex:1">
            <div class="sv-cf-t" id="sv-cf-t">${b(p)}</div>
            ${f?`<div class="sv-cf-d">${b(f)}</div>`:""}
            <input data-cf-in class="sv-cf-in" value="${c(e.valor||"")}" placeholder="${c(e.placeholder||"")}" autocomplete="off"
              style="margin-top:12px;width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--sv-line);border-radius:4px;font:inherit;font-family:var(--sv-mono)">
            <div data-cf-err style="display:none;color:#b91c1c;font-size:12px;margin-top:6px"></div>
          </div>
        </div>
        <div class="sv-cf-f">
          <button type="button" class="sv-btn" data-cf="0">${c(e.cancelar||"Cancelar")}</button>
          <button type="button" class="sv-btn-p" data-cf="1">${c(e.aceptar||"Guardar")}</button>
        </div></div>`;const m=a.querySelector("[data-cf-in]"),u=a.querySelector("[data-cf-err]"),o=t=>{if(document.removeEventListener("keydown",v,!0),a.classList.remove("is-on"),setTimeout(()=>a.remove(),120),d&&d.focus)try{d.focus()}catch{}y(t)},i=()=>{const t=m.value.trim();if(!t&&!e.opcional||t&&e.patron&&!e.patron.test(t)){u.textContent=e.error||"Dato no válido",u.style.display="",m.focus();return}o(t)},v=t=>{t.key==="Escape"?(t.preventDefault(),t.stopPropagation(),o(null)):t.key==="Enter"&&(t.preventDefault(),t.stopPropagation(),i())};a.addEventListener("click",t=>{t.target===a&&o(null)}),a.querySelector('[data-cf="0"]').addEventListener("click",()=>o(null)),a.querySelector('[data-cf="1"]').addEventListener("click",i),document.addEventListener("keydown",v,!0),document.body.appendChild(a),requestAnimationFrame(()=>a.classList.add("is-on")),m.focus()})}export{x as confirmar,$ as pedirDato};
