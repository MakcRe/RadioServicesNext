var _=Object.defineProperty;var I=(t,e,n)=>e in t?_(t,e,{enumerable:!0,configurable:!0,writable:!0,value:n}):t[e]=n;var v=(t,e,n)=>I(t,typeof e!="symbol"?e+"":e,n);function r(t,e=document){return e.querySelector(t)}function m(t,e=document){return Array.from(e.querySelectorAll(t))}function l(t,e="success"){let n=r("#toast-container");if(!n)return;let s=document.createElement("div");s.className=`toast ${e}`,s.textContent=t,n.appendChild(s),setTimeout(()=>{s.style.animation="slideIn 0.3s ease reverse",setTimeout(()=>s.remove(),300)},3e3)}function L(t,e=2){if(t===0)return"0 B";let n=1024,s=e<0?0:e,a=["B","KB","MB","GB","TB"],i=Math.floor(Math.log(t)/Math.log(n));return`${parseFloat((t/Math.pow(n,i)).toFixed(s))} ${a[i]}`}function F(t){let e=Date.now(),n=typeof t=="object"?t.getTime():new Date(t).getTime(),s=e-n,a=Math.floor(s/1e3),i=Math.floor(a/60),c=Math.floor(i/60),u=Math.floor(c/24);return u>0?`${u} \u5929\u524D`:c>0?`${c} \u5C0F\u65F6\u524D`:i>0?`${i} \u5206\u949F\u524D`:"\u521A\u521A"}function b(t){let e=Math.floor(t/3600),n=Math.floor(t%3600/60),s=Math.floor(t%60);return e>0?`${e}:${n.toString().padStart(2,"0")}:${s.toString().padStart(2,"0")}`:`${n}:${s.toString().padStart(2,"0")}`}var M=class{constructor(){v(this,"ws",null);v(this,"handlers",new Map);v(this,"reconnectAttempts",0);v(this,"maxReconnectAttempts",5);v(this,"reconnectDelay",1e3);v(this,"url");let e=location.protocol==="https:"?"wss:":"ws:";this.url=`${e}//${location.host}/ws`}connect(){this.ws?.readyState!==WebSocket.OPEN&&(this.ws=new WebSocket(this.url),this.ws.addEventListener("open",()=>{this.reconnectAttempts=0,console.debug("[ws] connected")}),this.ws.addEventListener("message",e=>{try{let n=JSON.parse(e.data);this.dispatch(n.type,n.data)}catch(n){console.error("[ws] failed to parse message:",n)}}),this.ws.addEventListener("close",()=>{console.debug("[ws] disconnected"),this.scheduleReconnect()}),this.ws.addEventListener("error",e=>{console.error("[ws] error:",e)}))}disconnect(){this.maxReconnectAttempts=0,this.ws?.close(),this.ws=null}on(e,n){return this.handlers.has(e)||this.handlers.set(e,new Set),this.handlers.get(e).add(n),()=>{this.handlers.get(e)?.delete(n)}}off(e,n){this.handlers.get(e)?.delete(n)}dispatch(e,n){this.handlers.get(e)?.forEach(s=>{try{s(n)}catch(a){console.error(`[ws] handler error for ${e}:`,a)}})}scheduleReconnect(){if(this.reconnectAttempts>=this.maxReconnectAttempts){console.warn("[ws] max reconnect attempts reached");return}let e=this.reconnectDelay*Math.pow(2,this.reconnectAttempts);this.reconnectAttempts++,console.debug(`[ws] reconnecting in ${e}ms (attempt ${this.reconnectAttempts})`),setTimeout(()=>this.connect(),e)}},h=new M;var d="";function p(t){if(!t.ok)throw new Error(`HTTP ${t.status}: ${t.statusText}`);return t.json()}var o={status:()=>fetch(`${d}/api/status`).then(p),ffmpegStatus:()=>fetch(`${d}/api/ffmpeg/status`).then(p),triggerFfmpegDownload:()=>fetch(`${d}/api/ffmpeg/download`,{method:"POST"}).then(p),sourceStart:(t,e)=>fetch(`${d}/api/source/start`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:t,id:e})}).then(p),sourceStop:()=>fetch(`${d}/api/source/stop`,{method:"POST"}).then(p),upload:async t=>{let e=new FormData;e.append("file",t);let n=await fetch(`${d}/api/source/upload`,{method:"POST",body:e});return p(n)},listFiles:()=>fetch(`${d}/api/source/files`).then(p),deleteFile:t=>fetch(`${d}/api/source/files/${t}`,{method:"DELETE"}).then(p),listPlaylist:()=>fetch(`${d}/api/playlist`).then(p),addToPlaylist:(t,e,n)=>fetch(`${d}/api/playlist`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:t,displayName:e,durationSec:n})}).then(p),deleteFromPlaylist:t=>fetch(`${d}/api/playlist/${t}`,{method:"DELETE"}).then(p),reorderPlaylist:t=>fetch(`${d}/api/playlist/reorder`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:t})}).then(p),listArchive:()=>fetch(`${d}/api/archive/list`).then(p),currentListeners:()=>fetch(`${d}/api/listeners/current`).then(p),historyListeners:(t=1)=>fetch(`${d}/api/listeners/history?page=${t}`).then(p),config:()=>fetch(`${d}/api/config`).then(p),updateConfig:(t,e)=>fetch(`${d}/api/config`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:t,value:e})}).then(p)};function C(t){let e=new EventSource(`${d}/api/ffmpeg/download/status`);return e.onmessage=n=>{try{t(JSON.parse(n.data))}catch{}},()=>e.close()}function P(){let t=r("#dashboard-view");t&&(j(t),w(),V())}function j(t){t.innerHTML=`
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-value" id="stat-live">
          <span class="status-indicator"></span>
          <span id="stat-live-text">--</span>
        </div>
        <div class="stat-label">\u76F4\u64AD\u72B6\u6001</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="stat-listeners">--</div>
        <div class="stat-label">\u5F53\u524D\u542C\u4F17</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="stat-bitrate">--</div>
        <div class="stat-label">\u7801\u7387</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">FFmpeg \u72B6\u6001</div>
      <div id="ffmpeg-status">
        <p class="text-muted">\u52A0\u8F7D\u4E2D...</p>
      </div>
    </div>

    <div class="card">
      <div class="card-title">\u6536\u542C\u5730\u5740</div>
      <div class="stream-url">
        <code>/stream</code>
        <button class="copy-btn" data-copy="/stream">\u590D\u5236</button>
      </div>
      <div class="stream-url">
        <code>/live.mp3</code>
        <button class="copy-btn" data-copy="/live.mp3">\u590D\u5236</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">\u6700\u8FD1 10 \u4E2A\u5207\u7247</div>
      <div class="segment-list" id="segment-list">
        <p class="text-muted">\u6682\u65E0\u5207\u7247</p>
      </div>
    </div>
  `,m(".copy-btn").forEach(e=>{e.addEventListener("click",()=>{let n=e.getAttribute("data-copy");n&&(navigator.clipboard.writeText(location.origin+n),l("\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F","success"))})})}async function w(){try{let[t,e]=await Promise.all([o.status(),o.ffmpegStatus().catch(()=>null)]);z(t),R(e)}catch(t){console.error("[dashboard] failed to load:",t)}}function z(t){let e=r("#stat-live-text"),n=r("#stat-live"),s=r("#stat-listeners"),a=r("#stat-bitrate"),i=r("#segment-list");if(e&&n){let c=!!t.broadcaster?.isLive;e.textContent=c?"LIVE":"OFFLINE",n.className=`stat-value ${c?"text-success":"text-muted"}`}s&&(s.textContent=String(t.listeners?.count??0)),a&&(a.textContent="--"),i&&(i.innerHTML='<p class="text-muted">\u6682\u65E0\u5207\u7247</p>')}function R(t){let e=r("#ffmpeg-status");if(e){if(!t){e.innerHTML='<p class="text-muted">FFmpeg \u672A\u5B89\u88C5\u6216\u65E0\u6CD5\u83B7\u53D6\u72B6\u6001</p>';return}e.innerHTML=`
    <table>
      <tr>
        <td class="text-muted">\u6570\u636E\u6E90</td>
        <td class="text-mono">${t.source||"\u672A\u77E5"}</td>
      </tr>
      <tr>
        <td class="text-muted">\u7248\u672C</td>
        <td class="text-mono">${t.version}</td>
      </tr>
      <tr>
        <td class="text-muted">\u8DEF\u5F84</td>
        <td class="text-mono">${t.path}</td>
      </tr>
    </table>
  `}}function V(){h.on("source-start",()=>{w()}),h.on("source-end",()=>{w()}),h.on("listener-count",()=>{w()}),h.on("archive-new",()=>{w()})}function g(t){let e=document.createElement("div");return e.textContent=t,e.innerHTML}async function k(t){t.innerHTML=`
    <div class="card">
      <div class="card-title">\u4E0A\u4F20\u97F3\u9891\u6587\u4EF6</div>
      <div class="upload-zone" id="upload-zone">
        <p>\u62D6\u62FD\u6587\u4EF6\u5230\u6B64\u5904\u6216\u70B9\u51FB\u9009\u62E9</p>
        <p class="text-muted">\u652F\u6301\u683C\u5F0F\uFF1AMP3, M4A, AAC, OGG, WAV, FLAC</p>
        <input type="file" id="file-input" accept=".mp3,.m4a,.aac,.ogg,.wav,.flac" multiple style="display: none">
      </div>
      <div class="upload-progress" id="upload-progress"></div>
    </div>

    <div class="card">
      <div class="card-title">\u5DF2\u4E0A\u4F20\u6587\u4EF6</div>
      <div id="files-list">
        <p class="text-muted">\u52A0\u8F7D\u4E2D...</p>
      </div>
    </div>

    <div class="card">
      <div class="card-title">\u64AD\u653E\u5217\u8868</div>
      <div id="playlist">
        <p class="text-muted">\u52A0\u8F7D\u4E2D...</p>
      </div>
    </div>
  `,J(),await S(),await T()}function J(){let t=r("#upload-zone"),e=r("#file-input");!t||!e||(t.addEventListener("click",()=>e.click()),t.addEventListener("dragover",n=>{n.preventDefault(),t.classList.add("drag-over")}),t.addEventListener("dragleave",()=>{t.classList.remove("drag-over")}),t.addEventListener("drop",n=>{n.preventDefault(),t.classList.remove("drag-over");let a=n.dataTransfer?.files;a&&A(Array.from(a))}),e.addEventListener("change",()=>{e.files&&(A(Array.from(e.files)),e.value="")}))}async function A(t){let e=r("#upload-progress");if(e){for(let n=0;n<t.length;n++){let s=t[n];e.innerHTML=`<p>\u6B63\u5728\u4E0A\u4F20: ${g(s.name)} (${n+1}/${t.length})</p>`;try{let a=await o.upload(s);l(`\u4E0A\u4F20\u6210\u529F: ${s.name}`,"success"),a&&a.filename&&(await o.addToPlaylist(a.filename,s.name.replace(/\.[^.]+$/,""),a.durationSec),await T())}catch(a){l(`\u4E0A\u4F20\u5931\u8D25: ${s.name}`,"error"),console.error("[source] upload error:",a)}}e.innerHTML="",await S()}}async function S(){let t=r("#files-list");if(t)try{let n=(await o.listFiles())?.files??[];if(n.length===0){t.innerHTML='<p class="text-muted">\u6682\u65E0\u5DF2\u4E0A\u4F20\u6587\u4EF6</p>';return}t.innerHTML=`
      <table>
        <thead>
          <tr>
            <th>\u6587\u4EF6\u540D</th>
            <th>\u5927\u5C0F</th>
            <th>\u65F6\u957F</th>
            <th>\u64CD\u4F5C</th>
          </tr>
        </thead>
        <tbody>
          ${n.map(s=>`
            <tr data-id="${s.id}">
              <td>${g(s.original_name||s.filename)}</td>
              <td>${L(s.size_bytes)}</td>
              <td>${s.duration_sec?b(s.duration_sec):"--"}</td>
              <td>
                <button class="btn-small play-btn" data-type="file" data-id="${s.id}">\u63A8\u6D41</button>
                <button class="btn-small add-playlist-btn" data-id="${s.id}" data-filename="${g(s.filename)}">\u52A0\u5230\u6B4C\u5355</button>
                <button class="btn-small btn-danger delete-btn" data-id="${s.id}">\u5220\u9664</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `,m(".play-btn").forEach(s=>{s.addEventListener("click",async()=>{let a=Number(s.getAttribute("data-id")),i=s.closest("tr")?.querySelector("td")?.textContent||"\u672A\u77E5";try{await o.sourceStart("file",a),l(`\u5F00\u59CB\u63A8\u6D41: ${g(i)}`,"success")}catch{l("\u63A8\u6D41\u542F\u52A8\u5931\u8D25","error")}})}),m(".add-playlist-btn").forEach(s=>{s.addEventListener("click",async()=>{let a=s.getAttribute("data-filename")||"",c=s.closest("tr")?.querySelector("td")?.textContent||"\u672A\u77E5";try{await o.addToPlaylist(a,c),l(`\u5DF2\u6DFB\u52A0\u5230\u6B4C\u5355: ${g(c)}`,"success"),await T()}catch{l("\u6DFB\u52A0\u5931\u8D25","error")}})}),m(".delete-btn").forEach(s=>{s.addEventListener("click",async()=>{let a=Number(s.getAttribute("data-id"));if(confirm("\u786E\u5B9A\u8981\u5220\u9664\u8FD9\u4E2A\u6587\u4EF6\u5417\uFF1F"))try{await o.deleteFile(a),l("\u6587\u4EF6\u5DF2\u5220\u9664","success"),await S()}catch{l("\u5220\u9664\u5931\u8D25","error")}})})}catch(e){t.innerHTML='<p class="text-muted">\u52A0\u8F7D\u5931\u8D25</p>',console.error("[source] load files error:",e)}}async function T(){let t=r("#playlist");if(t)try{let n=(await o.listPlaylist())?.items??[];if(n.length===0){t.innerHTML='<p class="text-muted">\u6B4C\u5355\u4E3A\u7A7A</p>';return}t.innerHTML=`
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>\u6B4C\u66F2</th>
            <th>\u65F6\u957F</th>
            <th>\u64CD\u4F5C</th>
          </tr>
        </thead>
        <tbody>
          ${n.map((a,i)=>`
            <tr data-id="${a.id}">
              <td>${i+1}</td>
              <td>${g(a.display_name||a.filename)}</td>
              <td>${a.duration_sec?b(a.duration_sec):"--"}</td>
              <td>
                <button class="btn-small play-btn" data-type="playlist" data-id="${a.id}">\u63A8\u6D41</button>
                <button class="btn-small btn-danger delete-btn" data-id="${a.id}">\u79FB\u9664</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `,m(".play-btn").forEach(a=>{a.addEventListener("click",async()=>{let i=Number(a.getAttribute("data-id")),c=a.getAttribute("data-type"),u=a.closest("tr")?.querySelectorAll("td")[1]?.textContent||"\u672A\u77E5";try{await o.sourceStart(c,i),l(`\u5F00\u59CB\u63A8\u6D41: ${g(u)}`,"success")}catch{l("\u63A8\u6D41\u542F\u52A8\u5931\u8D25","error")}})}),m(".delete-btn").forEach(a=>{a.addEventListener("click",async()=>{let i=Number(a.getAttribute("data-id"));if(confirm("\u786E\u5B9A\u8981\u4ECE\u6B4C\u5355\u79FB\u9664\u5417\uFF1F"))try{await o.deleteFromPlaylist(i),l("\u5DF2\u4ECE\u6B4C\u5355\u79FB\u9664","success"),await T()}catch{l("\u79FB\u9664\u5931\u8D25","error")}})});let s=document.createElement("button");s.className="btn btn-danger",s.textContent="\u505C\u6B62\u63A8\u6D41",s.style.marginTop="1rem",s.addEventListener("click",async()=>{try{await o.sourceStop(),l("\u5DF2\u505C\u6B62\u63A8\u6D41","success")}catch{l("\u505C\u6B62\u5931\u8D25","error")}}),t.appendChild(s)}catch(e){t.innerHTML='<p class="text-muted">\u52A0\u8F7D\u5931\u8D25</p>',console.error("[source] load playlist error:",e)}}function x(t){let e=document.createElement("div");return e.textContent=t,e.innerHTML}async function D(t){t.innerHTML=`
    <div class="card">
      <div class="card-title">\u5F53\u524D\u5728\u7EBF</div>
      <div id="current-listeners">
        <p class="text-muted">\u52A0\u8F7D\u4E2D...</p>
      </div>
    </div>

    <div class="card">
      <div class="card-title">\u5386\u53F2\u8BB0\u5F55</div>
      <div id="history-listeners">
        <p class="text-muted">\u52A0\u8F7D\u4E2D...</p>
      </div>
      <div class="pagination" id="pagination">
        <button class="btn-small" id="prev-page" disabled>\u4E0A\u4E00\u9875</button>
        <span id="page-info">\u7B2C 1 \u9875</span>
        <button class="btn-small" id="next-page">\u4E0B\u4E00\u9875</button>
      </div>
    </div>
  `;let e=1;r("#prev-page")?.addEventListener("click",async()=>{e>1&&(e--,await H(e))}),r("#next-page")?.addEventListener("click",async()=>{e++,await H(e)}),await Promise.all([q(),H(e)])}async function q(){let t=r("#current-listeners");if(t)try{let n=(await o.currentListeners())?.listeners??[];if(n.length===0){t.innerHTML='<p class="text-muted">\u5F53\u524D\u65E0\u542C\u4F17\u5728\u7EBF</p>';return}t.innerHTML=`
      <table>
        <thead>
          <tr>
            <th>IP\u5730\u5740</th>
            <th>\u8FDE\u63A5\u65F6\u95F4</th>
            <th>User-Agent</th>
          </tr>
        </thead>
        <tbody>
          ${n.map(s=>`
            <tr>
              <td class="text-mono">${x(s.ip||"\u672A\u77E5")}</td>
              <td>${s.connected_at?F(s.connected_at):"--"}</td>
              <td class="text-muted">${x(s.user_agent||"--")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <p class="text-muted" style="margin-top: 0.5rem">\u5171\u8BA1 ${n.length} \u4F4D\u5728\u7EBF</p>
    `}catch(e){t.innerHTML='<p class="text-muted">\u52A0\u8F7D\u5931\u8D25</p>',console.error("[listeners] current load error:",e)}}async function H(t){let e=r("#history-listeners"),n=r("#page-info"),s=r("#prev-page"),a=r("#next-page");if(e)try{let i=await o.historyListeners(t),c=i?.rows??[],u=i?.total??0,E=Math.max(1,Math.ceil(u/(i?.pageSize??50)));if(!c||c.length===0){e.innerHTML='<p class="text-muted">\u6682\u65E0\u5386\u53F2\u8BB0\u5F55</p>';return}e.innerHTML=`
      <table>
        <thead>
          <tr>
            <th>IP\u5730\u5740</th>
            <th>\u8FDB\u5165\u65F6\u95F4</th>
            <th>\u79BB\u5F00\u65F6\u95F4</th>
            <th>\u6301\u7EED\u65F6\u957F</th>
            <th>User-Agent</th>
          </tr>
        </thead>
        <tbody>
          ${c.map(f=>`
            <tr>
              <td class="text-mono">${x(f.ip||"\u672A\u77E5")}</td>
              <td>${f.connected_at?new Date(f.connected_at).toLocaleString("zh-CN"):"--"}</td>
              <td>${f.disconnected_at?new Date(f.disconnected_at).toLocaleString("zh-CN"):"\u5728\u7EBF"}</td>
              <td>${f.duration_sec?b(f.duration_sec):"--"}</td>
              <td class="text-muted">${x(f.user_agent||"--")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `,n&&(n.textContent=`\u7B2C ${t} / ${E} \u9875`),s&&(s.disabled=t<=1),a&&(a.disabled=t>=E)}catch(i){e.innerHTML='<p class="text-muted">\u52A0\u8F7D\u5931\u8D25</p>',console.error("[listeners] history load error:",i)}}function $(t){let e=document.createElement("div");return e.textContent=t,e.innerHTML}async function N(t){t.innerHTML=`
    <div class="card">
      <div class="card-title">\u5F55\u5236\u56DE\u653E</div>
      <div id="archive-list">
        <p class="text-muted">\u52A0\u8F7D\u4E2D...</p>
      </div>
    </div>
  `,await K()}async function K(){let t=r("#archive-list");if(t)try{let n=(await o.listArchive())?.files??[];if(n.length===0){t.innerHTML='<p class="text-muted">\u6682\u65E0\u5F55\u5236\u56DE\u653E</p>';return}let s={};for(let i of n){let c=new Date(i.mtime).toLocaleDateString("zh-CN",{year:"numeric",month:"2-digit",day:"2-digit"});s[c]||(s[c]=[]),s[c].push(i)}let a="";for(let[i,c]of Object.entries(s))a+=`
        <div class="archive-date-group">
          <h3 class="archive-date-title">${$(i)}</h3>
          <div class="archive-list">
            ${c.map(u=>`
              <div class="archive-item" data-name="${$(u.filename)}">
                <div class="archive-info">
                  <span class="archive-name">${$(u.filename)}</span>
                  <span class="archive-meta">${L(u.sizeBytes)}</span>
                  <span class="archive-meta">${new Date(u.mtime).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})}</span>
                </div>
                <div class="archive-actions">
                  <audio controls class="archive-audio">
                    <source src="/archive/${$(u.filename)}" type="audio/mpeg">
                    \u60A8\u7684\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u97F3\u9891\u64AD\u653E
                  </audio>
                  <a href="/archive/${$(u.filename)}" download class="btn-small">\u4E0B\u8F7D</a>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      `;t.innerHTML=a}catch(e){t.innerHTML='<p class="text-muted">\u52A0\u8F7D\u5931\u8D25</p>',console.error("[archive] load error:",e)}}function y(t){let e=document.createElement("div");return e.textContent=t,e.innerHTML}async function B(t){t.innerHTML=`
    <div class="card">
      <div class="card-title">FFmpeg \u72B6\u6001</div>
      <div id="ffmpeg-status-content">
        <p class="text-muted">\u52A0\u8F7D\u4E2D...</p>
      </div>
    </div>

    <div class="card">
      <div class="card-title">\u4E0B\u8F7D\u5B89\u88C5</div>
      <div id="ffmpeg-download-content">
        <p class="text-muted">\u52A0\u8F7D\u4E2D...</p>
      </div>
    </div>
  `,await W()}async function W(){let t=r("#ffmpeg-status-content"),e=r("#ffmpeg-download-content");try{let n=await o.ffmpegStatus();t&&(t.innerHTML=`
        <table>
          <tr>
            <td class="text-muted">\u53EF\u7528\u72B6\u6001</td>
            <td>
              <span class="status-indicator ${n.available?"active":"inactive"}"></span>
              ${n.available?"\u5DF2\u5B89\u88C5":"\u672A\u5B89\u88C5"}
            </td>
          </tr>
          <tr>
            <td class="text-muted">\u6570\u636E\u6E90</td>
            <td>${y(n.source||"\u672A\u77E5")}</td>
          </tr>
          <tr>
            <td class="text-muted">\u7248\u672C</td>
            <td class="text-mono">${y(n.version||"--")}</td>
          </tr>
          <tr>
            <td class="text-muted">\u8DEF\u5F84</td>
            <td class="text-mono">${y(n.path||"--")}</td>
          </tr>
        </table>
      `),e&&(n.available?e.innerHTML=`
          <p class="text-success">\u2713 FFmpeg \u5DF2\u5B89\u88C5\u5E76\u53EF\u7528</p>
        `:(e.innerHTML=`
          <p class="text-muted">FFmpeg \u672A\u5B89\u88C5\uFF0C\u9700\u8981\u4E0B\u8F7D\u540E\u624D\u80FD\u4F7F\u7528\u5F55\u5236\u529F\u80FD\u3002</p>
          <button class="btn" id="download-ffmpeg-btn">\u4E0B\u8F7D FFmpeg</button>
          <div id="download-progress" class="download-progress"></div>
          ${G()?'<p class="text-muted" style="margin-top: 1rem"><strong>\u63D0\u793A\uFF1A</strong> macOS \u53EF\u80FD\u9700\u8981\u5141\u8BB8"\u4EFB\u4F55\u6765\u6E90"\u5E94\u7528\u4EE5\u8FD0\u884C FFmpeg\u3002\u8BF7\u5728\u7EC8\u7AEF\u8FD0\u884C\uFF1A<code>sudo spctl --master-disable</code></p>':""}
        `,r("#download-ffmpeg-btn")?.addEventListener("click",U)))}catch(n){console.error("[ffmpeg-panel] status error:",n),t&&(t.innerHTML='<p class="text-muted">\u65E0\u6CD5\u83B7\u53D6 FFmpeg \u72B6\u6001</p>'),e&&(e.innerHTML='<p class="text-muted">\u52A0\u8F7D\u5931\u8D25</p>')}}async function U(){let t=r("#download-progress"),e=r("#download-ffmpeg-btn");if(!t)return;e&&(e.disabled=!0,e.textContent="\u4E0B\u8F7D\u4E2D...");try{await o.triggerFfmpegDownload()}catch(s){console.error("[ffmpeg-panel] trigger error:",s)}let n=C(s=>{if(t)switch(s.status){case"downloading":t.innerHTML=`
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${s.progress||0}%"></div>
          </div>
          <p class="text-muted">${y(s.message||"\u4E0B\u8F7D\u4E2D...")} ${s.progress||0}%</p>
        `;break;case"installing":t.innerHTML=`
          <p class="text-muted">${y(s.message||"\u5B89\u88C5\u4E2D...")}</p>
        `;break;case"done":t.innerHTML='<p class="text-success">\u2713 FFmpeg \u5B89\u88C5\u6210\u529F\uFF01</p>',setTimeout(()=>W(),1500);break;case"error":t.innerHTML=`<p class="text-error">\u2717 \u5B89\u88C5\u5931\u8D25: ${y(s.error||"\u672A\u77E5\u9519\u8BEF")}</p>`,e&&(e.disabled=!1,e.textContent="\u91CD\u8BD5");break}});setTimeout(()=>{t.innerHTML.includes("\u4E0B\u8F7D\u4E2D")&&n()},3e5)}function G(){return navigator.platform.toLowerCase().includes("mac")}function Z(){let t=m(".tab-button");t.forEach(e=>{e.addEventListener("click",()=>{let n=e.getAttribute("data-tab");t.forEach(i=>i.classList.remove("active")),e.classList.add("active"),m(".tab-panel").forEach(i=>i.classList.remove("active"));let a=r(`#${n}-view`);a&&a.classList.add("active"),O(n)})})}function Q(){let t=r("#source-view");t&&k(t)}function X(){let t=r("#listeners-view");t&&D(t)}function Y(){let t=r("#archive-view");t&&N(t)}function tt(){let t=r("#ffmpeg-view");t&&B(t)}async function O(t){switch(t){case"dashboard":P();break;case"source":await Q();break;case"listeners":await X();break;case"archive":await Y();break;case"ffmpeg":await tt();break}}function et(){Z(),O("dashboard"),h.connect(),setInterval(async()=>{try{let e=await o.status();nt(e)}catch(e){console.debug("[polling] failed:",e)}},5e3)}function nt(t){let e=r("#disconnect-warning");e&&(!t.source?.connected&&t.stream?.live?e.style.display="inline-block":e.style.display="none")}document.addEventListener("DOMContentLoaded",et);
//# sourceMappingURL=app.js.map
