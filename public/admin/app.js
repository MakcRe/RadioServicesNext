var N=Object.defineProperty;var j=(t,e,s)=>e in t?N(t,e,{enumerable:!0,configurable:!0,writable:!0,value:s}):t[e]=s;var g=(t,e,s)=>j(t,typeof e!="symbol"?e+"":e,s);function o(t){let e=document.createElement("div");return e.textContent=t,e.innerHTML}function b(t){if(t==null||t==="")return null;let e=Number(t);return!Number.isFinite(e)||!Number.isInteger(e)||e<=0?null:e}function r(t,e=document){return e.querySelector(t)}function f(t,e=document){return Array.from(e.querySelectorAll(t))}function l(t,e="success"){let s=r("#toast-container");if(!s)return;let n=document.createElement("div");n.className=`toast ${e}`,n.textContent=t,s.appendChild(n),setTimeout(()=>{n.style.animation="slideIn 0.3s ease reverse",setTimeout(()=>n.remove(),300)},3e3)}function y(t,e=2){if(t===0)return"0 B";let s=1024,n=e<0?0:e,a=["B","KB","MB","GB","TB"],i=Math.floor(Math.log(t)/Math.log(s));return`${parseFloat((t/Math.pow(s,i)).toFixed(n))} ${a[i]}`}function F(t){let e=Date.now(),s=typeof t=="object"?t.getTime():new Date(t).getTime(),n=e-s,a=Math.floor(n/1e3),i=Math.floor(a/60),d=Math.floor(i/60),m=Math.floor(d/24);return m>0?`${m} \u5929\u524D`:d>0?`${d} \u5C0F\u65F6\u524D`:i>0?`${i} \u5206\u949F\u524D`:"\u521A\u521A"}function w(t){let e=Math.floor(t/3600),s=Math.floor(t%3600/60),n=Math.floor(t%60);return e>0?`${e}:${s.toString().padStart(2,"0")}:${n.toString().padStart(2,"0")}`:`${s}:${n.toString().padStart(2,"0")}`}var x=class{constructor(){g(this,"ws",null);g(this,"handlers",new Map);g(this,"reconnectAttempts",0);g(this,"maxReconnectAttempts",5);g(this,"reconnectDelay",1e3);g(this,"url");let e=location.protocol==="https:"?"wss:":"ws:";this.url=`${e}//${location.host}/ws`}connect(){this.ws?.readyState!==WebSocket.OPEN&&(this.ws=new WebSocket(this.url),this.ws.addEventListener("open",()=>{this.reconnectAttempts=0,console.debug("[ws] connected")}),this.ws.addEventListener("message",e=>{try{let s=JSON.parse(e.data);this.dispatch(s.type,s.data)}catch(s){console.error("[ws] failed to parse message:",s)}}),this.ws.addEventListener("close",()=>{console.debug("[ws] disconnected"),this.scheduleReconnect()}),this.ws.addEventListener("error",e=>{console.error("[ws] error:",e)}))}disconnect(){this.maxReconnectAttempts=0,this.ws?.close(),this.ws=null}on(e,s){return this.handlers.has(e)||this.handlers.set(e,new Set),this.handlers.get(e).add(s),()=>{this.handlers.get(e)?.delete(s)}}off(e,s){this.handlers.get(e)?.delete(s)}dispatch(e,s){this.handlers.get(e)?.forEach(n=>{try{n(s)}catch(a){console.error(`[ws] handler error for ${e}:`,a)}})}scheduleReconnect(){if(this.reconnectAttempts>=this.maxReconnectAttempts){console.warn("[ws] max reconnect attempts reached");return}let e=this.reconnectDelay*Math.pow(2,this.reconnectAttempts);this.reconnectAttempts++,console.debug(`[ws] reconnecting in ${e}ms (attempt ${this.reconnectAttempts})`),setTimeout(()=>this.connect(),e)}},h=new x;var p="";function M(t){return t.ok?t.json():Promise.reject(new Error(`HTTP ${t.status}: ${t.statusText}`))}async function u(t,e){let s=await fetch(t,e);return M(s)}var c={status:()=>u(`${p}/api/status`),ffmpegStatus:()=>u(`${p}/api/ffmpeg/status`),triggerFfmpegDownload:()=>u(`${p}/api/ffmpeg/download`,{method:"POST"}),sourceStart:(t,e)=>u(`${p}/api/source/start`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:t,id:e})}),sourceStop:()=>u(`${p}/api/source/stop`,{method:"POST"}),upload:async t=>{let e=new FormData;e.append("file",t);let s=await fetch(`${p}/api/source/upload`,{method:"POST",body:e});return M(s)},listFiles:()=>u(`${p}/api/source/files`),deleteFile:t=>u(`${p}/api/source/files/${t}`,{method:"DELETE"}),listPlaylist:()=>u(`${p}/api/playlist`),addToPlaylist:(t,e,s)=>u(`${p}/api/playlist`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:t,displayName:e,durationSec:s})}),deleteFromPlaylist:t=>u(`${p}/api/playlist/${t}`,{method:"DELETE"}),reorderPlaylist:t=>u(`${p}/api/playlist/reorder`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:t})}),listArchive:()=>u(`${p}/api/archive/list`),currentListeners:()=>u(`${p}/api/listeners/current`),historyListeners:(t=1)=>u(`${p}/api/listeners/history?page=${t}`),config:()=>u(`${p}/api/config`),updateConfig:(t,e)=>u(`${p}/api/config`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:t,value:e})})};function H(t){let e=new EventSource(`${p}/api/ffmpeg/download/status`);return e.onmessage=s=>{try{t(JSON.parse(s.data))}catch{}},()=>e.close()}function P(){let t=r("#dashboard-view");t&&(W(t),L(),z())}function W(t){t.innerHTML=`
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
  `,f(".copy-btn").forEach(e=>{e.addEventListener("click",()=>{let s=e.getAttribute("data-copy");s&&(navigator.clipboard.writeText(location.origin+s),l("\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F","success"))})})}async function L(){try{let[t,e]=await Promise.all([c.status(),c.ffmpegStatus().catch(()=>null)]);_(t),U(e)}catch(t){console.error("[dashboard] failed to load:",t)}}function _(t){let e=r("#stat-live-text"),s=r("#stat-live"),n=r("#stat-listeners"),a=r("#stat-bitrate"),i=r("#segment-list");if(e&&s){let d=!!t.broadcaster?.isLive;e.textContent=d?"LIVE":"OFFLINE",s.className=`stat-value ${d?"text-success":"text-muted"}`}n&&(n.textContent=String(t.listeners?.count??0)),a&&(a.textContent="--"),i&&(i.innerHTML='<p class="text-muted">\u6682\u65E0\u5207\u7247</p>')}function U(t){let e=r("#ffmpeg-status");if(e){if(!t||!t.available){e.innerHTML='<p class="text-muted">FFmpeg \u672A\u5B89\u88C5\u6216\u65E0\u6CD5\u83B7\u53D6\u72B6\u6001</p>';return}e.innerHTML=`
    <table>
      <tr>
        <td class="text-muted">\u6570\u636E\u6E90</td>
        <td class="text-mono">${t.source}</td>
      </tr>
      <tr>
        <td class="text-muted">\u7248\u672C</td>
        <td class="text-mono">${t.version??"\u672A\u77E5"}</td>
      </tr>
      <tr>
        <td class="text-muted">\u8DEF\u5F84</td>
        <td class="text-mono">${t.path??"\u672A\u77E5"}</td>
      </tr>
    </table>
  `}}function z(){h.on("source-start",()=>{L()}),h.on("source-end",()=>{L()}),h.on("listener-count",()=>{L()}),h.on("archive-new",()=>{L()})}async function k(t){t.innerHTML=`
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
  `,q(),await E(),await $()}function q(){let t=r("#upload-zone"),e=r("#file-input");!t||!e||(t.addEventListener("click",()=>e.click()),t.addEventListener("dragover",s=>{s.preventDefault(),t.classList.add("drag-over")}),t.addEventListener("dragleave",()=>{t.classList.remove("drag-over")}),t.addEventListener("drop",s=>{s.preventDefault(),t.classList.remove("drag-over");let a=s.dataTransfer?.files;a&&A(Array.from(a))}),e.addEventListener("change",()=>{e.files&&(A(Array.from(e.files)),e.value="")}))}async function A(t){let e=r("#upload-progress");if(e){for(let s=0;s<t.length;s++){let n=t[s];e.innerHTML=`<p>\u6B63\u5728\u4E0A\u4F20: ${o(n.name)} (${s+1}/${t.length})</p>`;try{let a=await c.upload(n);l(`\u4E0A\u4F20\u6210\u529F: ${n.name}`,"success"),a&&a.filename&&(await c.addToPlaylist(a.filename,n.name.replace(/\.[^.]+$/,""),a.durationSec),await $())}catch(a){l(`\u4E0A\u4F20\u5931\u8D25: ${n.name}`,"error"),console.error("[source] upload error:",a)}}e.innerHTML="",await E()}}async function E(){let t=r("#files-list");if(t)try{let s=(await c.listFiles())?.files??[];if(s.length===0){t.innerHTML='<p class="text-muted">\u6682\u65E0\u5DF2\u4E0A\u4F20\u6587\u4EF6</p>';return}t.innerHTML=`
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
          ${s.map(n=>`
            <tr data-id="${n.id}">
              <td>${o(n.original_name||n.filename)}</td>
              <td>${y(n.size_bytes)}</td>
              <td>${n.duration_sec?w(n.duration_sec):"--"}</td>
              <td>
                <button class="btn-small play-btn" data-type="file" data-id="${n.id}">\u63A8\u6D41</button>
                <button class="btn-small add-playlist-btn" data-id="${n.id}" data-filename="${o(n.filename)}">\u52A0\u5230\u6B4C\u5355</button>
                <button class="btn-small btn-danger delete-btn" data-id="${n.id}">\u5220\u9664</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `,f(".play-btn").forEach(n=>{n.addEventListener("click",async()=>{let a=b(n.getAttribute("data-id"));if(a===null){l("\u65E0\u6548\u7684\u6587\u4EF6 ID","error");return}let i=n.closest("tr")?.querySelector("td")?.textContent||"\u672A\u77E5";try{await c.sourceStart("file",a),l(`\u5F00\u59CB\u63A8\u6D41: ${o(i)}`,"success")}catch{l("\u63A8\u6D41\u542F\u52A8\u5931\u8D25","error")}})}),f(".add-playlist-btn").forEach(n=>{n.addEventListener("click",async()=>{let a=n.getAttribute("data-filename")||"",d=n.closest("tr")?.querySelector("td")?.textContent||"\u672A\u77E5";try{await c.addToPlaylist(a,d),l(`\u5DF2\u6DFB\u52A0\u5230\u6B4C\u5355: ${o(d)}`,"success"),await $()}catch{l("\u6DFB\u52A0\u5931\u8D25","error")}})}),f(".delete-btn").forEach(n=>{n.addEventListener("click",async()=>{let a=b(n.getAttribute("data-id"));if(a===null){l("\u65E0\u6548\u7684\u6587\u4EF6 ID","error");return}if(confirm("\u786E\u5B9A\u8981\u5220\u9664\u8FD9\u4E2A\u6587\u4EF6\u5417\uFF1F"))try{await c.deleteFile(a),l("\u6587\u4EF6\u5DF2\u5220\u9664","success"),await E()}catch{l("\u5220\u9664\u5931\u8D25","error")}})})}catch(e){t.innerHTML='<p class="text-muted">\u52A0\u8F7D\u5931\u8D25</p>',console.error("[source] load files error:",e)}}async function $(){let t=r("#playlist");if(t)try{let s=(await c.listPlaylist())?.items??[];if(s.length===0){t.innerHTML='<p class="text-muted">\u6B4C\u5355\u4E3A\u7A7A</p>';return}t.innerHTML=`
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
          ${s.map((a,i)=>`
            <tr data-id="${a.id}">
              <td>${i+1}</td>
              <td>${o(a.display_name||a.filename)}</td>
              <td>${a.duration_sec?w(a.duration_sec):"--"}</td>
              <td>
                <button class="btn-small play-btn" data-type="playlist" data-id="${a.id}">\u63A8\u6D41</button>
                <button class="btn-small btn-danger delete-btn" data-id="${a.id}">\u79FB\u9664</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `,f(".play-btn").forEach(a=>{a.addEventListener("click",async()=>{let i=b(a.getAttribute("data-id"));if(i===null){l("\u65E0\u6548\u7684\u6B4C\u66F2 ID","error");return}let d=a.getAttribute("data-type"),m=a.closest("tr")?.querySelectorAll("td")[1]?.textContent||"\u672A\u77E5";try{await c.sourceStart(d,i),l(`\u5F00\u59CB\u63A8\u6D41: ${o(m)}`,"success")}catch{l("\u63A8\u6D41\u542F\u52A8\u5931\u8D25","error")}})}),f(".delete-btn").forEach(a=>{a.addEventListener("click",async()=>{let i=b(a.getAttribute("data-id"));if(i===null){l("\u65E0\u6548\u7684\u6B4C\u66F2 ID","error");return}if(confirm("\u786E\u5B9A\u8981\u4ECE\u6B4C\u5355\u79FB\u9664\u5417\uFF1F"))try{await c.deleteFromPlaylist(i),l("\u5DF2\u4ECE\u6B4C\u5355\u79FB\u9664","success"),await $()}catch{l("\u79FB\u9664\u5931\u8D25","error")}})});let n=document.createElement("button");n.className="btn btn-danger",n.textContent="\u505C\u6B62\u63A8\u6D41",n.style.marginTop="1rem",n.addEventListener("click",async()=>{try{await c.sourceStop(),l("\u5DF2\u505C\u6B62\u63A8\u6D41","success")}catch{l("\u505C\u6B62\u5931\u8D25","error")}}),t.appendChild(n)}catch(e){t.innerHTML='<p class="text-muted">\u52A0\u8F7D\u5931\u8D25</p>',console.error("[source] load playlist error:",e)}}async function C(t){t.innerHTML=`
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
  `;let e=1;r("#prev-page")?.addEventListener("click",async()=>{e>1&&(e--,await S(e))}),r("#next-page")?.addEventListener("click",async()=>{e++,await S(e)}),await Promise.all([J(),S(e)])}async function J(){let t=r("#current-listeners");if(t)try{let s=(await c.currentListeners())?.listeners??[];if(s.length===0){t.innerHTML='<p class="text-muted">\u5F53\u524D\u65E0\u542C\u4F17\u5728\u7EBF</p>';return}t.innerHTML=`
      <table>
        <thead>
          <tr>
            <th>IP\u5730\u5740</th>
            <th>\u8FDE\u63A5\u65F6\u95F4</th>
            <th>User-Agent</th>
          </tr>
        </thead>
        <tbody>
          ${s.map(n=>`
            <tr>
              <td class="text-mono">${o(n.ip||"\u672A\u77E5")}</td>
              <td>${n.connected_at?F(n.connected_at):"--"}</td>
              <td class="text-muted">${o(n.user_agent||"--")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <p class="text-muted" style="margin-top: 0.5rem">\u5171\u8BA1 ${s.length} \u4F4D\u5728\u7EBF</p>
    `}catch(e){t.innerHTML='<p class="text-muted">\u52A0\u8F7D\u5931\u8D25</p>',console.error("[listeners] current load error:",e)}}async function S(t){let e=r("#history-listeners"),s=r("#page-info"),n=r("#prev-page"),a=r("#next-page");if(e)try{let i=await c.historyListeners(t),d=i?.rows??[],m=i?.total??0,T=Math.max(1,Math.ceil(m/(i?.pageSize??50)));if(!d||d.length===0){e.innerHTML='<p class="text-muted">\u6682\u65E0\u5386\u53F2\u8BB0\u5F55</p>';return}e.innerHTML=`
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
          ${d.map(v=>`
            <tr>
              <td class="text-mono">${o(v.ip||"\u672A\u77E5")}</td>
              <td>${v.connected_at?new Date(v.connected_at).toLocaleString("zh-CN"):"--"}</td>
              <td>${v.disconnected_at?new Date(v.disconnected_at).toLocaleString("zh-CN"):"\u5728\u7EBF"}</td>
              <td>${v.duration_sec?w(v.duration_sec):"--"}</td>
              <td class="text-muted">${o(v.user_agent||"--")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `,s&&(s.textContent=`\u7B2C ${t} / ${T} \u9875`),n&&(n.disabled=t<=1),a&&(a.disabled=t>=T)}catch(i){e.innerHTML='<p class="text-muted">\u52A0\u8F7D\u5931\u8D25</p>',console.error("[listeners] history load error:",i)}}async function D(t){t.innerHTML=`
    <div class="card">
      <div class="card-title">\u5F55\u5236\u56DE\u653E</div>
      <div id="archive-list">
        <p class="text-muted">\u52A0\u8F7D\u4E2D...</p>
      </div>
    </div>
  `,await V()}async function V(){let t=r("#archive-list");if(t)try{let s=(await c.listArchive())?.files??[];if(s.length===0){t.innerHTML='<p class="text-muted">\u6682\u65E0\u5F55\u5236\u56DE\u653E</p>';return}let n={};for(let i of s){let d=new Date(i.mtime).toLocaleDateString("zh-CN",{year:"numeric",month:"2-digit",day:"2-digit"});n[d]||(n[d]=[]),n[d].push(i)}let a="";for(let[i,d]of Object.entries(n))a+=`
        <div class="archive-date-group">
          <h3 class="archive-date-title">${o(i)}</h3>
          <div class="archive-list">
            ${d.map(m=>`
              <div class="archive-item" data-name="${o(m.filename)}">
                <div class="archive-info">
                  <span class="archive-name">${o(m.filename)}</span>
                  <span class="archive-meta">${y(m.sizeBytes)}</span>
                  <span class="archive-meta">${new Date(m.mtime).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})}</span>
                </div>
                <div class="archive-actions">
                  <audio controls class="archive-audio">
                    <source src="/archive/${o(m.filename)}" type="audio/mpeg">
                    \u60A8\u7684\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u97F3\u9891\u64AD\u653E
                  </audio>
                  <a href="/archive/${o(m.filename)}" download class="btn-small">\u4E0B\u8F7D</a>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      `;t.innerHTML=a}catch(e){t.innerHTML='<p class="text-muted">\u52A0\u8F7D\u5931\u8D25</p>',console.error("[archive] load error:",e)}}async function I(t){t.innerHTML=`
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
  `,await O()}async function O(){let t=r("#ffmpeg-status-content"),e=r("#ffmpeg-download-content");try{let s=await c.ffmpegStatus();t&&(t.innerHTML=`
        <table>
          <tr>
            <td class="text-muted">\u53EF\u7528\u72B6\u6001</td>
            <td>
              <span class="status-indicator ${s.available?"active":"inactive"}"></span>
              ${s.available?"\u5DF2\u5B89\u88C5":"\u672A\u5B89\u88C5"}
            </td>
          </tr>
          <tr>
            <td class="text-muted">\u6570\u636E\u6E90</td>
            <td>${o(s.source||"\u672A\u77E5")}</td>
          </tr>
          <tr>
            <td class="text-muted">\u7248\u672C</td>
            <td class="text-mono">${o(s.version??"--")}</td>
          </tr>
          <tr>
            <td class="text-muted">\u8DEF\u5F84</td>
            <td class="text-mono">${o(s.path??"--")}</td>
          </tr>
        </table>
      `),e&&(e.innerHTML=K(s),G(e))}catch(s){console.error("[ffmpeg-panel] status error:",s),t&&(t.innerHTML='<p class="text-muted">\u65E0\u6CD5\u83B7\u53D6 FFmpeg \u72B6\u6001</p>'),e&&(e.innerHTML='<p class="text-muted">\u52A0\u8F7D\u5931\u8D25</p>')}}function K(t){return t.source==="bundled"||t.source==="override"?'<p class="text-success">\u2713 FFmpeg \u5DF2\u5B89\u88C5\u5E76\u53EF\u7528</p>':t.source==="system"?`
      <p class="text-warning">\u26A0 \u542F\u52A8\u65F6\u4E0B\u8F7D\u5931\u8D25\uFF0C\u76EE\u524D\u4F7F\u7528\u7CFB\u7EDF FFmpeg\u3002\u5EFA\u8BAE\u91CD\u65B0\u4E0B\u8F7D\u9879\u76EE\u5185\u7248\u672C\u4EE5\u4FDD\u8BC1\u7248\u672C\u4E00\u81F4\u3002</p>
      <button class="btn" id="download-ffmpeg-btn">\u4E0B\u8F7D\u9879\u76EE\u5185 FFmpeg</button>
      <div id="download-progress" class="download-progress"></div>
      ${R()?'<p class="text-muted" style="margin-top: 1rem"><strong>\u63D0\u793A\uFF1A</strong> macOS \u53EF\u80FD\u9700\u8981\u5141\u8BB8"\u4EFB\u4F55\u6765\u6E90"\u5E94\u7528\u4EE5\u8FD0\u884C FFmpeg\u3002\u8BF7\u5728\u7EC8\u7AEF\u8FD0\u884C\uFF1A<code>sudo spctl --master-disable</code></p>':""}
    `:`
    <p class="text-muted">FFmpeg \u672A\u5B89\u88C5\uFF0C\u9700\u8981\u4E0B\u8F7D\u540E\u624D\u80FD\u4F7F\u7528\u5F55\u5236\u529F\u80FD\u3002</p>
    <button class="btn" id="download-ffmpeg-btn">\u4E0B\u8F7D FFmpeg</button>
    <div id="download-progress" class="download-progress"></div>
    ${R()?'<p class="text-muted" style="margin-top: 1rem"><strong>\u63D0\u793A\uFF1A</strong> macOS \u53EF\u80FD\u9700\u8981\u5141\u8BB8"\u4EFB\u4F55\u6765\u6E90"\u5E94\u7528\u4EE5\u8FD0\u884C FFmpeg\u3002\u8BF7\u5728\u7EC8\u7AEF\u8FD0\u884C\uFF1A<code>sudo spctl --master-disable</code></p>':""}
  `}function G(t){t.querySelector("#download-ffmpeg-btn")?.addEventListener("click",Z)}async function Z(){let t=r("#download-progress"),e=r("#download-ffmpeg-btn");if(!t)return;e&&(e.disabled=!0,e.textContent="\u4E0B\u8F7D\u4E2D...");try{await c.triggerFfmpegDownload()}catch(n){console.error("[ffmpeg-panel] trigger error:",n)}let s=H(n=>{if(t)switch(n.state){case"downloading":t.innerHTML=`
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${n.percent||0}%"></div>
          </div>
          <p class="text-muted">\u4E0B\u8F7D\u4E2D ${(n.percent??0).toFixed(1)}% \xB7 ${y(n.speed)}/s</p>
        `;break;case"verifying":case"extracting":t.innerHTML=`
          <p class="text-muted">${o(n.message)}</p>
        `;break;case"complete":t.innerHTML='<p class="text-success">\u2713 FFmpeg \u5B89\u88C5\u6210\u529F\uFF01</p>',setTimeout(()=>O(),1500);break;case"error":t.innerHTML=`<p class="text-error">\u2717 \u5B89\u88C5\u5931\u8D25: ${o(n.message)}</p>`,e&&(e.disabled=!1,e.textContent="\u91CD\u8BD5");break;case"idle":t.innerHTML='<p class="text-muted">\u7A7A\u95F2</p>';break}});setTimeout(()=>{t.innerHTML.includes("\u4E0B\u8F7D\u4E2D")&&s()},3e5)}function R(){return navigator.platform.toLowerCase().includes("mac")}function Q(){let t=f(".tab-button");t.forEach(e=>{e.addEventListener("click",()=>{let s=e.getAttribute("data-tab");t.forEach(i=>i.classList.remove("active")),e.classList.add("active"),f(".tab-panel").forEach(i=>i.classList.remove("active"));let a=r(`#${s}-view`);a&&a.classList.add("active"),B(s)})})}function X(){let t=r("#source-view");t&&k(t)}function Y(){let t=r("#listeners-view");t&&C(t)}function tt(){let t=r("#archive-view");t&&D(t)}function et(){let t=r("#ffmpeg-view");t&&I(t)}async function B(t){switch(t){case"dashboard":P();break;case"source":await X();break;case"listeners":await Y();break;case"archive":await tt();break;case"ffmpeg":await et();break}}function st(){Q(),B("dashboard"),h.connect(),setInterval(async()=>{try{let e=await c.status();nt(e)}catch(e){console.debug("[polling] failed:",e)}},5e3)}function nt(t){let e=r("#disconnect-warning");e&&(!!t.broadcaster?.isLive?e.style.display="none":e.style.display="inline-block")}document.addEventListener("DOMContentLoaded",st);
//# sourceMappingURL=app.js.map
