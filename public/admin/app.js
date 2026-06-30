var B=Object.defineProperty;var V=(t,e,s)=>e in t?B(t,e,{enumerable:!0,configurable:!0,writable:!0,value:s}):t[e]=s;var h=(t,e,s)=>V(t,typeof e!="symbol"?e+"":e,s);function o(t){let e=document.createElement("div");return e.textContent=t,e.innerHTML}function b(t){if(t==null||t==="")return null;let e=Number(t);return!Number.isFinite(e)||!Number.isInteger(e)||e<=0?null:e}function a(t,e=document){return e.querySelector(t)}function f(t,e=document){return Array.from(e.querySelectorAll(t))}function p(t,e="success"){let s=a("#toast-container");if(!s)return;let n=document.createElement("div");n.className=`toast ${e}`,n.textContent=t,s.appendChild(n),setTimeout(()=>{n.style.animation="slideIn 0.3s ease reverse",setTimeout(()=>n.remove(),300)},3e3)}function y(t,e=2){if(t===0)return"0 B";let s=1024,n=e<0?0:e,i=["B","KB","MB","GB","TB"],r=Math.floor(Math.log(t)/Math.log(s));return`${parseFloat((t/Math.pow(s,r)).toFixed(n))} ${i[r]}`}function P(t){let e=Date.now(),s=typeof t=="object"?t.getTime():new Date(t).getTime(),n=e-s,i=Math.floor(n/1e3),r=Math.floor(i/60),d=Math.floor(r/60),m=Math.floor(d/24);return m>0?`${m} \u5929\u524D`:d>0?`${d} \u5C0F\u65F6\u524D`:r>0?`${r} \u5206\u949F\u524D`:"\u521A\u521A"}function w(t){let e=Math.floor(t/3600),s=Math.floor(t%3600/60),n=Math.floor(t%60);return e>0?`${e}:${s.toString().padStart(2,"0")}:${n.toString().padStart(2,"0")}`:`${s}:${n.toString().padStart(2,"0")}`}var T=class{constructor(){h(this,"ws",null);h(this,"handlers",new Map);h(this,"reconnectAttempts",0);h(this,"maxReconnectAttempts",5);h(this,"reconnectDelay",1e3);h(this,"url");let e=location.protocol==="https:"?"wss:":"ws:";this.url=`${e}//${location.host}/ws`}connect(){this.ws?.readyState!==WebSocket.OPEN&&(this.ws=new WebSocket(this.url),this.ws.addEventListener("open",()=>{this.reconnectAttempts=0,console.debug("[ws] connected")}),this.ws.addEventListener("message",e=>{try{let s=JSON.parse(e.data);this.dispatch(s.type,s.data)}catch(s){console.error("[ws] failed to parse message:",s)}}),this.ws.addEventListener("close",()=>{console.debug("[ws] disconnected"),this.scheduleReconnect()}),this.ws.addEventListener("error",e=>{console.error("[ws] error:",e)}))}disconnect(){this.maxReconnectAttempts=0,this.ws?.close(),this.ws=null}on(e,s){return this.handlers.has(e)||this.handlers.set(e,new Set),this.handlers.get(e).add(s),()=>{this.handlers.get(e)?.delete(s)}}off(e,s){this.handlers.get(e)?.delete(s)}dispatch(e,s){this.handlers.get(e)?.forEach(n=>{try{n(s)}catch(i){console.error(`[ws] handler error for ${e}:`,i)}})}scheduleReconnect(){if(this.reconnectAttempts>=this.maxReconnectAttempts){console.warn("[ws] max reconnect attempts reached");return}let e=this.reconnectDelay*Math.pow(2,this.reconnectAttempts);this.reconnectAttempts++,console.debug(`[ws] reconnecting in ${e}ms (attempt ${this.reconnectAttempts})`),setTimeout(()=>this.connect(),e)}},g=new T;var l="";function R(t){return t.ok?t.json():Promise.reject(new Error(`HTTP ${t.status}: ${t.statusText}`))}async function u(t,e){let s=await fetch(t,e);return R(s)}var c={status:()=>u(`${l}/api/status`),ffmpegStatus:()=>u(`${l}/api/ffmpeg/status`),triggerFfmpegDownload:()=>u(`${l}/api/ffmpeg/download`,{method:"POST"}),sourceStart:(t,e)=>u(`${l}/api/source/start`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:t,id:e})}),sourceStop:()=>u(`${l}/api/source/stop`,{method:"POST"}),upload:async t=>{let e=new FormData;e.append("file",t);let s=await fetch(`${l}/api/source/upload`,{method:"POST",body:e});return R(s)},listFiles:()=>u(`${l}/api/source/files`),deleteFile:t=>u(`${l}/api/source/files/${t}`,{method:"DELETE"}),listPlaylist:()=>u(`${l}/api/playlist`),addToPlaylist:(t,e,s)=>u(`${l}/api/playlist`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:t,displayName:e,durationSec:s})}),deleteFromPlaylist:t=>u(`${l}/api/playlist/${t}`,{method:"DELETE"}),reorderPlaylist:t=>u(`${l}/api/playlist/reorder`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:t})}),listArchive:()=>u(`${l}/api/archive/list`),currentListeners:()=>u(`${l}/api/listeners/current`),historyListeners:(t=1)=>u(`${l}/api/listeners/history?page=${t}`),config:()=>u(`${l}/api/config`),updateConfig:(t,e)=>u(`${l}/api/config`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:t,value:e})}),listFfmpegVersions:()=>u(`${l}/api/ffmpeg/versions`),selectFfmpegVersion:t=>u(`${l}/api/ffmpeg/select`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({version:t})}),listRemoteFfmpegVersions:()=>u(`${l}/api/ffmpeg/remote-versions`),downloadFfmpegVersion:t=>u(`${l}/api/ffmpeg/download`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({version:t})})};function C(t){let e=new EventSource(`${l}/api/ffmpeg/download/status`);return e.onmessage=s=>{try{t(JSON.parse(s.data))}catch{}},()=>e.close()}function k(){let t=a("#dashboard-view");t&&(W(t),$(),z())}function W(t){t.innerHTML=`
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
  `,f(".copy-btn").forEach(e=>{e.addEventListener("click",()=>{let s=e.getAttribute("data-copy");s&&(navigator.clipboard.writeText(location.origin+s),p("\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F","success"))})})}async function $(){try{let[t,e]=await Promise.all([c.status(),c.ffmpegStatus().catch(()=>null)]);_(t),U(e)}catch(t){console.error("[dashboard] failed to load:",t)}}function _(t){let e=a("#stat-live-text"),s=a("#stat-live"),n=a("#stat-listeners"),i=a("#stat-bitrate"),r=a("#segment-list");if(e&&s){let d=!!t.broadcaster?.isLive;e.textContent=d?"LIVE":"OFFLINE",s.className=`stat-value ${d?"text-success":"text-muted"}`}n&&(n.textContent=String(t.listeners?.count??0)),i&&(i.textContent="--"),r&&(r.innerHTML='<p class="text-muted">\u6682\u65E0\u5207\u7247</p>')}function U(t){let e=a("#ffmpeg-status");if(e){if(!t||!t.available){e.innerHTML='<p class="text-muted">FFmpeg \u672A\u5B89\u88C5\u6216\u65E0\u6CD5\u83B7\u53D6\u72B6\u6001</p>';return}e.innerHTML=`
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
  `}}function z(){g.on("source-start",()=>{$()}),g.on("source-end",()=>{$()}),g.on("listener-count",()=>{$()}),g.on("archive-new",()=>{$()})}async function D(t){t.innerHTML=`
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
  `,J(),await E(),await L()}function J(){let t=a("#upload-zone"),e=a("#file-input");!t||!e||(t.addEventListener("click",()=>e.click()),t.addEventListener("dragover",s=>{s.preventDefault(),t.classList.add("drag-over")}),t.addEventListener("dragleave",()=>{t.classList.remove("drag-over")}),t.addEventListener("drop",s=>{s.preventDefault(),t.classList.remove("drag-over");let i=s.dataTransfer?.files;i&&A(Array.from(i))}),e.addEventListener("change",()=>{e.files&&(A(Array.from(e.files)),e.value="")}))}async function A(t){let e=a("#upload-progress");if(e){for(let s=0;s<t.length;s++){let n=t[s];e.innerHTML=`<p>\u6B63\u5728\u4E0A\u4F20: ${o(n.name)} (${s+1}/${t.length})</p>`;try{let i=await c.upload(n);p(`\u4E0A\u4F20\u6210\u529F: ${n.name}`,"success"),i&&i.filename&&(await c.addToPlaylist(i.filename,n.name.replace(/\.[^.]+$/,""),i.durationSec),await L())}catch(i){p(`\u4E0A\u4F20\u5931\u8D25: ${n.name}`,"error"),console.error("[source] upload error:",i)}}e.innerHTML="",await E()}}async function E(){let t=a("#files-list");if(t)try{let s=(await c.listFiles())?.files??[];if(s.length===0){t.innerHTML='<p class="text-muted">\u6682\u65E0\u5DF2\u4E0A\u4F20\u6587\u4EF6</p>';return}t.innerHTML=`
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
    `,f(".play-btn").forEach(n=>{n.addEventListener("click",async()=>{let i=b(n.getAttribute("data-id"));if(i===null){p("\u65E0\u6548\u7684\u6587\u4EF6 ID","error");return}let r=n.closest("tr")?.querySelector("td")?.textContent||"\u672A\u77E5";try{await c.sourceStart("file",i),p(`\u5F00\u59CB\u63A8\u6D41: ${o(r)}`,"success")}catch{p("\u63A8\u6D41\u542F\u52A8\u5931\u8D25","error")}})}),f(".add-playlist-btn").forEach(n=>{n.addEventListener("click",async()=>{let i=n.getAttribute("data-filename")||"",d=n.closest("tr")?.querySelector("td")?.textContent||"\u672A\u77E5";try{await c.addToPlaylist(i,d),p(`\u5DF2\u6DFB\u52A0\u5230\u6B4C\u5355: ${o(d)}`,"success"),await L()}catch{p("\u6DFB\u52A0\u5931\u8D25","error")}})}),f(".delete-btn").forEach(n=>{n.addEventListener("click",async()=>{let i=b(n.getAttribute("data-id"));if(i===null){p("\u65E0\u6548\u7684\u6587\u4EF6 ID","error");return}if(confirm("\u786E\u5B9A\u8981\u5220\u9664\u8FD9\u4E2A\u6587\u4EF6\u5417\uFF1F"))try{await c.deleteFile(i),p("\u6587\u4EF6\u5DF2\u5220\u9664","success"),await E()}catch{p("\u5220\u9664\u5931\u8D25","error")}})})}catch(e){t.innerHTML='<p class="text-muted">\u52A0\u8F7D\u5931\u8D25</p>',console.error("[source] load files error:",e)}}async function L(){let t=a("#playlist");if(t)try{let s=(await c.listPlaylist())?.items??[];if(s.length===0){t.innerHTML='<p class="text-muted">\u6B4C\u5355\u4E3A\u7A7A</p>';return}t.innerHTML=`
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
          ${s.map((i,r)=>`
            <tr data-id="${i.id}">
              <td>${r+1}</td>
              <td>${o(i.display_name||i.filename)}</td>
              <td>${i.duration_sec?w(i.duration_sec):"--"}</td>
              <td>
                <button class="btn-small play-btn" data-type="playlist" data-id="${i.id}">\u63A8\u6D41</button>
                <button class="btn-small btn-danger delete-btn" data-id="${i.id}">\u79FB\u9664</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `,f(".play-btn").forEach(i=>{i.addEventListener("click",async()=>{let r=b(i.getAttribute("data-id"));if(r===null){p("\u65E0\u6548\u7684\u6B4C\u66F2 ID","error");return}let d=i.getAttribute("data-type"),m=i.closest("tr")?.querySelectorAll("td")[1]?.textContent||"\u672A\u77E5";try{await c.sourceStart(d,r),p(`\u5F00\u59CB\u63A8\u6D41: ${o(m)}`,"success")}catch{p("\u63A8\u6D41\u542F\u52A8\u5931\u8D25","error")}})}),f(".delete-btn").forEach(i=>{i.addEventListener("click",async()=>{let r=b(i.getAttribute("data-id"));if(r===null){p("\u65E0\u6548\u7684\u6B4C\u66F2 ID","error");return}if(confirm("\u786E\u5B9A\u8981\u4ECE\u6B4C\u5355\u79FB\u9664\u5417\uFF1F"))try{await c.deleteFromPlaylist(r),p("\u5DF2\u4ECE\u6B4C\u5355\u79FB\u9664","success"),await L()}catch{p("\u79FB\u9664\u5931\u8D25","error")}})});let n=document.createElement("button");n.className="btn btn-danger",n.textContent="\u505C\u6B62\u63A8\u6D41",n.style.marginTop="1rem",n.addEventListener("click",async()=>{try{await c.sourceStop(),p("\u5DF2\u505C\u6B62\u63A8\u6D41","success")}catch{p("\u505C\u6B62\u5931\u8D25","error")}}),t.appendChild(n)}catch(e){t.innerHTML='<p class="text-muted">\u52A0\u8F7D\u5931\u8D25</p>',console.error("[source] load playlist error:",e)}}async function O(t){t.innerHTML=`
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
  `;let e=1;a("#prev-page")?.addEventListener("click",async()=>{e>1&&(e--,await S(e))}),a("#next-page")?.addEventListener("click",async()=>{e++,await S(e)}),await Promise.all([q(),S(e)])}async function q(){let t=a("#current-listeners");if(t)try{let s=(await c.currentListeners())?.listeners??[];if(s.length===0){t.innerHTML='<p class="text-muted">\u5F53\u524D\u65E0\u542C\u4F17\u5728\u7EBF</p>';return}t.innerHTML=`
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
              <td>${n.connected_at?P(n.connected_at):"--"}</td>
              <td class="text-muted">${o(n.user_agent||"--")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <p class="text-muted" style="margin-top: 0.5rem">\u5171\u8BA1 ${s.length} \u4F4D\u5728\u7EBF</p>
    `}catch(e){t.innerHTML='<p class="text-muted">\u52A0\u8F7D\u5931\u8D25</p>',console.error("[listeners] current load error:",e)}}async function S(t){let e=a("#history-listeners"),s=a("#page-info"),n=a("#prev-page"),i=a("#next-page");if(e)try{let r=await c.historyListeners(t),d=r?.rows??[],m=r?.total??0,x=Math.max(1,Math.ceil(m/(r?.pageSize??50)));if(!d||d.length===0){e.innerHTML='<p class="text-muted">\u6682\u65E0\u5386\u53F2\u8BB0\u5F55</p>';return}e.innerHTML=`
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
    `,s&&(s.textContent=`\u7B2C ${t} / ${x} \u9875`),n&&(n.disabled=t<=1),i&&(i.disabled=t>=x)}catch(r){e.innerHTML='<p class="text-muted">\u52A0\u8F7D\u5931\u8D25</p>',console.error("[listeners] history load error:",r)}}async function I(t){t.innerHTML=`
    <div class="card">
      <div class="card-title">\u5F55\u5236\u56DE\u653E</div>
      <div id="archive-list">
        <p class="text-muted">\u52A0\u8F7D\u4E2D...</p>
      </div>
    </div>
  `,await K()}async function K(){let t=a("#archive-list");if(t)try{let s=(await c.listArchive())?.files??[];if(s.length===0){t.innerHTML='<p class="text-muted">\u6682\u65E0\u5F55\u5236\u56DE\u653E</p>';return}let n={};for(let r of s){let d=new Date(r.mtime).toLocaleDateString("zh-CN",{year:"numeric",month:"2-digit",day:"2-digit"});n[d]||(n[d]=[]),n[d].push(r)}let i="";for(let[r,d]of Object.entries(n))i+=`
        <div class="archive-date-group">
          <h3 class="archive-date-title">${o(r)}</h3>
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
      `;t.innerHTML=i}catch(e){t.innerHTML='<p class="text-muted">\u52A0\u8F7D\u5931\u8D25</p>',console.error("[archive] load error:",e)}}async function j(t){t.innerHTML=`
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

    <div class="card">
      <div class="card-title">\u7248\u672C\u7BA1\u7406</div>
      <div id="ffmpeg-versions-content">
        <p class="text-muted">\u52A0\u8F7D\u4E2D...</p>
      </div>
    </div>
  `,await Promise.all([M(),F(),H()])}async function M(){let t=a("#ffmpeg-status-content"),e=a("#ffmpeg-download-content");try{let s=await c.ffmpegStatus();t&&(t.innerHTML=`
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
      `),e&&(e.innerHTML="",await F())}catch(s){console.error("[ffmpeg-panel] status error:",s),t&&(t.innerHTML='<p class="text-muted">\u65E0\u6CD5\u83B7\u53D6 FFmpeg \u72B6\u6001</p>'),e&&(e.innerHTML='<p class="text-muted">\u52A0\u8F7D\u5931\u8D25</p>')}}async function F(){let t=a("#ffmpeg-download-content");if(t)try{let{versions:e}=await c.listRemoteFfmpegVersions();if(e.length===0){t.innerHTML='<p class="text-muted">\u6682\u65E0\u53EF\u4E0B\u8F7D\u7684\u8FDC\u7A0B\u7248\u672C\uFF08\u7F51\u7EDC\u4E0D\u53EF\u8FBE\uFF1F\uFF09</p>';return}let s=e.map(n=>{let i=n.installed?'<span class="text-muted">\u5DF2\u5B89\u88C5</span>':`<button class="btn-small download-btn" data-version="${o(n.version)}">\u4E0B\u8F7D</button>`;return`
          <li class="remote-version-item">
            <span class="text-mono">${o(n.version)}</span>
            ${i}
          </li>
        `}).join("");t.innerHTML=`
      <p class="text-muted">\u8FDC\u7A0B\u53EF\u4E0B\u8F7D\u7248\u672C\uFF08\u6309\u7248\u672C\u53F7\u6392\u5E8F\uFF09\uFF1A</p>
      <ul class="remote-version-list">${s}</ul>
      <div id="download-progress" class="download-progress"></div>
    `,t.querySelectorAll(".download-btn").forEach(n=>{n.addEventListener("click",()=>{let i=n.dataset.version;i&&G(i,n)})})}catch(e){console.error("[ffmpeg-panel] remote versions error:",e),t.innerHTML='<p class="text-muted">\u65E0\u6CD5\u52A0\u8F7D\u8FDC\u7A0B\u7248\u672C\u5217\u8868</p>'}}async function G(t,e){let s=a("#download-progress");if(!s)return;e.disabled=!0;let n=e.textContent;e.textContent="\u4E0B\u8F7D\u4E2D...";try{await c.downloadFfmpegVersion(t)}catch(r){console.error("[ffmpeg-panel] trigger error:",r)}let i=C(r=>{if(s)switch(r.state){case"downloading":s.innerHTML=`
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${r.percent||0}%"></div>
          </div>
          <p class="text-muted">\u4E0B\u8F7D ${o(t)} \u4E2D ${(r.percent??0).toFixed(1)}% \xB7 ${y(r.speed)}/s</p>
        `;break;case"verifying":case"extracting":s.innerHTML=`
          <p class="text-muted">${o(r.message)}</p>
        `;break;case"complete":s.innerHTML=`<p class="text-success">\u2713 ${o(t)} \u5B89\u88C5\u6210\u529F</p>`,setTimeout(()=>{Promise.all([M(),F(),H()])},800),i();return;case"error":s.innerHTML=`<p class="text-error">\u2717 \u5B89\u88C5\u5931\u8D25: ${o(r.message)}</p>`,e.disabled=!1,e.textContent=n,i();return;case"idle":s.innerHTML='<p class="text-muted">\u7A7A\u95F2</p>';break}});setTimeout(()=>{s.innerHTML.includes("\u4E0B\u8F7D\u4E2D")&&i()},3e5)}async function H(){let t=a("#ffmpeg-versions-content");if(t)try{let e=await c.listFfmpegVersions();if(e.versions.length===0){t.innerHTML='<p class="text-muted">\u6682\u65E0\u5DF2\u5B89\u88C5\u7248\u672C</p>';return}let s=e.versions.map(n=>{let i=[n===e.current?"\uFF08\u5F53\u524D\uFF09":"",n===e.recommended?" \u2605":""].filter(Boolean).join("");return`<option value="${o(n)}"${n===e.current?" selected":""}>${o(n)}${i}</option>`}).join("");t.innerHTML=`
      <p class="text-muted">\u5DF2\u5B89\u88C5\u7248\u672C\uFF08\u6309\u8BED\u4E49\u7248\u672C\u6392\u5E8F\uFF09\uFF1A</p>
      <div class="version-row">
        <select id="ffmpeg-version-select" class="select">${s}</select>
        <button class="btn" id="switch-version-btn">\u5207\u6362\u7248\u672C</button>
      </div>
      <p id="switch-feedback" class="text-muted" style="margin-top: 0.5rem; min-height: 1.2em"></p>
    `,a("#switch-version-btn")?.addEventListener("click",Z)}catch(e){console.error("[ffmpeg-panel] versions error:",e),t.innerHTML='<p class="text-muted">\u65E0\u6CD5\u52A0\u8F7D\u7248\u672C\u5217\u8868</p>'}}async function Z(){let t=a("#ffmpeg-version-select"),e=a("#switch-feedback"),s=a("#switch-version-btn");if(!t)return;let n=t.value;e&&(e.textContent=""),s&&(s.disabled=!0,s.textContent="\u5207\u6362\u4E2D...");try{let i=await c.selectFfmpegVersion(n);i.success?(e&&(e.textContent=i.available?`\u2713 \u5DF2\u5207\u6362\u5230 ${n}\uFF08\u5B9E\u65F6\u751F\u6548\uFF09`:`\u26A0 \u5DF2\u9009\u62E9 ${n}\uFF0C\u4F46\u8BE5\u7248\u672C\u5C1A\u672A\u5B89\u88C5`,e.className=i.available?"text-success":"text-warning"),await Promise.all([M(),H()])):alert(`\u5207\u6362\u5931\u8D25: ${i.message}`)}catch(i){console.error("[ffmpeg-panel] switch error:",i),alert("\u5207\u6362\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5")}finally{s&&(s.disabled=!1,s.textContent="\u5207\u6362\u7248\u672C")}}function Q(){let t=f(".tab-button");t.forEach(e=>{e.addEventListener("click",()=>{let s=e.getAttribute("data-tab");t.forEach(r=>r.classList.remove("active")),e.classList.add("active"),f(".tab-panel").forEach(r=>r.classList.remove("active"));let i=a(`#${s}-view`);i&&i.classList.add("active"),N(s)})})}function X(){let t=a("#source-view");t&&D(t)}function Y(){let t=a("#listeners-view");t&&O(t)}function tt(){let t=a("#archive-view");t&&I(t)}function et(){let t=a("#ffmpeg-view");t&&j(t)}async function N(t){switch(t){case"dashboard":k();break;case"source":await X();break;case"listeners":await Y();break;case"archive":await tt();break;case"ffmpeg":await et();break}}function st(){Q(),N("dashboard"),g.connect(),setInterval(async()=>{try{let e=await c.status();nt(e)}catch(e){console.debug("[polling] failed:",e)}},5e3)}function nt(t){let e=a("#disconnect-warning");e&&(!!t.broadcaster?.isLive?e.style.display="none":e.style.display="inline-block")}document.addEventListener("DOMContentLoaded",st);
//# sourceMappingURL=app.js.map
