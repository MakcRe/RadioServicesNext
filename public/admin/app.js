var w=Object.defineProperty;var T=(t,e,s)=>e in t?w(t,e,{enumerable:!0,configurable:!0,writable:!0,value:s}):t[e]=s;var l=(t,e,s)=>T(t,typeof e!="symbol"?e+"":e,s);function n(t,e=document){return e.querySelector(t)}function u(t,e=document){return Array.from(e.querySelectorAll(t))}function g(t,e="success"){let s=n("#toast-container");if(!s)return;let r=document.createElement("div");r.className=`toast ${e}`,r.textContent=t,s.appendChild(r),setTimeout(()=>{r.style.animation="slideIn 0.3s ease reverse",setTimeout(()=>r.remove(),300)},3e3)}function b(t,e=2){if(t===0)return"0 B";let s=1024,r=e<0?0:e,c=["B","KB","MB","GB","TB"],o=Math.floor(Math.log(t)/Math.log(s));return`${parseFloat((t/Math.pow(s,o)).toFixed(r))} ${c[o]}`}var v=class{constructor(){l(this,"ws",null);l(this,"handlers",new Map);l(this,"reconnectAttempts",0);l(this,"maxReconnectAttempts",5);l(this,"reconnectDelay",1e3);l(this,"url");let e=location.protocol==="https:"?"wss:":"ws:";this.url=`${e}//${location.host}/ws`}connect(){this.ws?.readyState!==WebSocket.OPEN&&(this.ws=new WebSocket(this.url),this.ws.addEventListener("open",()=>{this.reconnectAttempts=0,console.debug("[ws] connected")}),this.ws.addEventListener("message",e=>{try{let s=JSON.parse(e.data);this.dispatch(s.type,s.data)}catch(s){console.error("[ws] failed to parse message:",s)}}),this.ws.addEventListener("close",()=>{console.debug("[ws] disconnected"),this.scheduleReconnect()}),this.ws.addEventListener("error",e=>{console.error("[ws] error:",e)}))}disconnect(){this.maxReconnectAttempts=0,this.ws?.close(),this.ws=null}on(e,s){return this.handlers.has(e)||this.handlers.set(e,new Set),this.handlers.get(e).add(s),()=>{this.handlers.get(e)?.delete(s)}}off(e,s){this.handlers.get(e)?.delete(s)}dispatch(e,s){this.handlers.get(e)?.forEach(r=>{try{r(s)}catch(c){console.error(`[ws] handler error for ${e}:`,c)}})}scheduleReconnect(){if(this.reconnectAttempts>=this.maxReconnectAttempts){console.warn("[ws] max reconnect attempts reached");return}let e=this.reconnectDelay*Math.pow(2,this.reconnectAttempts);this.reconnectAttempts++,console.debug(`[ws] reconnecting in ${e}ms (attempt ${this.reconnectAttempts})`),setTimeout(()=>this.connect(),e)}},d=new v;var a="";function i(t){if(!t.ok)throw new Error(`HTTP ${t.status}: ${t.statusText}`);return t.json()}var m={status:()=>fetch(`${a}/api/status`).then(i),ffmpegStatus:()=>fetch(`${a}/api/ffmpeg/status`).then(i),triggerFfmpegDownload:()=>fetch(`${a}/api/ffmpeg/download`,{method:"POST"}).then(i),sourceStart:(t,e)=>fetch(`${a}/api/source/start`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:t,id:e})}).then(i),sourceStop:()=>fetch(`${a}/api/source/stop`,{method:"POST"}).then(i),upload:async t=>{let e=new FormData;e.append("file",t);let s=await fetch(`${a}/api/source/upload`,{method:"POST",body:e});return i(s)},listFiles:()=>fetch(`${a}/api/source/files`).then(i),deleteFile:t=>fetch(`${a}/api/source/files/${t}`,{method:"DELETE"}).then(i),listPlaylist:()=>fetch(`${a}/api/playlist`).then(i),addToPlaylist:(t,e,s)=>fetch(`${a}/api/playlist`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:t,displayName:e,durationSec:s})}).then(i),deleteFromPlaylist:t=>fetch(`${a}/api/playlist/${t}`,{method:"DELETE"}).then(i),reorderPlaylist:t=>fetch(`${a}/api/playlist/reorder`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:t})}).then(i),listArchive:()=>fetch(`${a}/api/archive/list`).then(i),currentListeners:()=>fetch(`${a}/api/listeners/current`).then(i),historyListeners:(t=1)=>fetch(`${a}/api/listeners/history?page=${t}`).then(i),config:()=>fetch(`${a}/api/config`).then(i),updateConfig:(t,e)=>fetch(`${a}/api/config`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:t,value:e})}).then(i)};function y(){let t=n("#dashboard-view");t&&(E(t),f(),L())}function E(t){t.innerHTML=`
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
  `,u(".copy-btn").forEach(e=>{e.addEventListener("click",()=>{let s=e.getAttribute("data-copy");s&&(navigator.clipboard.writeText(location.origin+s),g("\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F","success"))})})}async function f(){try{let[t,e]=await Promise.all([m.status(),m.ffmpegStatus().catch(()=>null)]);$(t),x(e)}catch(t){console.error("[dashboard] failed to load:",t)}}function $(t){let e=n("#stat-live-text"),s=n("#stat-live"),r=n("#stat-listeners"),c=n("#stat-bitrate"),o=n("#segment-list");if(e&&s){let p=t.source?.connected&&t.stream?.live;e.textContent=p?"LIVE":"OFFLINE",s.className=`stat-value ${p?"text-success":"text-muted"}`}if(r&&(r.textContent=String(t.stream?.listeners??0)),c&&(c.textContent=t.source?.bitrate?`${t.source.bitrate} kbps`:"--"),o){let p=t.stream?.segments?.slice(0,10)??[];p.length===0?o.innerHTML='<p class="text-muted">\u6682\u65E0\u5207\u7247</p>':o.innerHTML=p.map(h=>`
          <div class="segment-item">
            <span class="segment-name">${h.name}</span>
            <span class="segment-size">${b(h.size)}</span>
          </div>
        `).join("")}}function x(t){let e=n("#ffmpeg-status");if(e){if(!t){e.innerHTML='<p class="text-muted">FFmpeg \u672A\u5B89\u88C5\u6216\u65E0\u6CD5\u83B7\u53D6\u72B6\u6001</p>';return}e.innerHTML=`
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
  `}}function L(){d.on("source-start",()=>{f()}),d.on("source-end",()=>{f()}),d.on("listener-count",()=>{f()}),d.on("archive-new",()=>{f()})}function S(){let t=u(".tab-button");t.forEach(e=>{e.addEventListener("click",()=>{let s=e.getAttribute("data-tab");t.forEach(o=>o.classList.remove("active")),e.classList.add("active"),u(".tab-panel").forEach(o=>o.classList.remove("active"));let c=n(`#${s}-view`);c&&c.classList.add("active")})})}function M(t){switch(t){case"dashboard":y();break;case"source":H();break;case"listeners":k();break;case"archive":A();break;case"ffmpeg":C();break}}function H(){let t=n("#source-view");t&&(t.innerHTML=`
    <div class="card">
      <div class="card-title">\u63A8\u6D41\u8BBE\u7F6E</div>
      <p class="text-muted">\u63A8\u6D41\u5730\u5740\uFF1A<code class="text-mono">${location.protocol}//${location.host}/stream</code></p>
      <p class="text-muted mt-2">\u5F53\u524D\u72B6\u6001\uFF1A<span id="source-status-badge">--</span></p>
    </div>
  `,d.on("source-start",()=>{let e=n("#source-status-badge");e&&(e.innerHTML='<span class="status-badge active">\u5DF2\u8FDE\u63A5</span>')}),d.on("source-end",()=>{let e=n("#source-status-badge");e&&(e.innerHTML='<span class="status-badge inactive">\u672A\u8FDE\u63A5</span>')}))}function k(){let t=n("#listeners-view");t&&(t.innerHTML=`
    <div class="card">
      <div class="card-title">\u5F53\u524D\u542C\u4F17</div>
      <div id="current-listeners">
        <p class="text-muted">\u52A0\u8F7D\u4E2D...</p>
      </div>
    </div>
  `)}function A(){let t=n("#archive-view");t&&(t.innerHTML=`
    <div class="card">
      <div class="card-title">\u5F55\u5236\u6587\u4EF6</div>
      <div id="archive-list">
        <p class="text-muted">\u52A0\u8F7D\u4E2D...</p>
      </div>
    </div>
  `)}function C(){let t=n("#config-view");t&&(t.innerHTML=`
    <div class="card">
      <div class="card-title">\u7CFB\u7EDF\u914D\u7F6E</div>
      <p class="text-muted">\u914D\u7F6E\u754C\u9762\u5F00\u53D1\u4E2D...</p>
    </div>
  `)}function D(){S(),M("dashboard"),d.connect(),setInterval(async()=>{try{let e=await m.status();W(e)}catch(e){console.debug("[polling] failed:",e)}},5e3)}function W(t){let e=n("#disconnect-warning");e&&(!t.source?.connected&&t.stream?.live?e.style.display="inline-block":e.style.display="none")}document.addEventListener("DOMContentLoaded",D);
//# sourceMappingURL=app.js.map
