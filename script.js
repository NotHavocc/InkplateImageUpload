import { ESPLoader, Transport } from "https://unpkg.com/esptool-js/bundle.js";

const PALETTE = [
  {name:'black', rgb:[0,0,0]},
  {name:'white', rgb:[255,255,255]},
  {name:'red',   rgb:[255,0,0]},
];

const espLoaderTerminal = {
    clean() { terminal.innerHTML = ""; },
    writeLine(data) { terminal.innerHTML += data + "<br/>"; terminal.scrollTop = terminal.scrollHeight; },
    write(data) { terminal.innerHTML += data; terminal.scrollTop = terminal.scrollHeight; }
};

const itemSelector = document.getElementById('itemSelector');
const customResolution = document.getElementById('customResolution');

const flashBtn = document.getElementById('flashBtn');
const firmwareFile = document.getElementById('firmwareFile');
const terminal = document.getElementById('terminal');

const fileInput = document.getElementById('fileInput');
const outW = document.getElementById('outW');
const outH = document.getElementById('outH');
const keepAspect = document.getElementById('keepAspect');
const pixelArt = document.getElementById('pixelArt');
const modeSel = document.getElementById('mode');
const serpentineField = document.getElementById('serpentineField');
const serpentine = document.getElementById('serpentine');
const amountField = document.getElementById('amountField');
const amount = document.getElementById('amount');
const amountVal = document.getElementById('amountVal');
const redBias = document.getElementById('redBias');
const redBiasVal = document.getElementById('redBiasVal');
const runBtn = document.getElementById('runBtn');
const useOriginalSize = document.getElementById('useOriginalSize');
const srcCanvas = document.getElementById('srcCanvas');
const outCanvas = document.getElementById('outCanvas');
const stats = document.getElementById('stats');
const arraySection = document.getElementById('arraySection');
const emptyMsg = document.getElementById('emptyMsg');
const formatSel = document.getElementById('format');
const output = document.getElementById('output');
const copyBtn = document.getElementById('copyBtn');
const downloadBtn = document.getElementById('downloadBtn');

const mockupContainer = document.querySelector('.mockup-container.inkplate-bg');

const uploadBleBtn = document.getElementById('uploadBleBtn');
const bleStatus = document.getElementById('bleStatus');

let loadedImg = null;
let lastIndexBuffer = null, lastW = 0, lastH = 0;

const DEVICE_NAME_PREFIX = "ESP32"; 
const BLE_SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b"; 

const presets = {
    "Inkplate-2": [212, 104],
    "1.54-epaper": [200, 200],
    "0.96-oled": [128, 64],
    "custom": [212, 104]
};

function clearDitherPreview() {
    const octx = outCanvas.getContext('2d');
    octx.clearRect(0, 0, outCanvas.width, outCanvas.height);
 
    lastIndexBuffer = null; 

    stats.innerHTML = '';
    if (emptyMsg) emptyMsg.style.display = '';
    if (arraySection) arraySection.style.display = 'none';
}

itemSelector.addEventListener('change', (event) => {
    const selectedValue = event.target.value;

    clearDitherPreview();

    mockupContainer.setAttribute('data-device', selectedValue);
    mockupContainer.style.width = '';
    mockupContainer.style.height = '';
    mockupContainer.style.backgroundImage = '';

    if (selectedValue === 'custom') {
        customResolution.style.display = 'block';
    } else {
        customResolution.style.display = 'none';

        const [width, height] = presets[selectedValue];
        outW.value = width;
        outH.value = height;
    }
});

function updateBleLog(msg) {
  if (bleStatus) {
    bleStatus.innerText = `Status: ${msg}`;
  }
  console.log(`[BLE] ${msg}`);
}

flashBtn.addEventListener('click', async () => {
    try {
        espLoaderTerminal.clean();
        espLoaderTerminal.writeLine("Fetching firmware from server...");

        const response = await fetch('./firmware/firmware.bin');
        
        if (!response.ok) {
            throw new Error(`Failed to fetch firmware file from server (Status: ${response.status})`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const firmwareBuffer = new Uint8Array(arrayBuffer);

        espLoaderTerminal.writeLine("Firmware downloaded successfully. Initializing hardware connection...");

        await startFlashing(firmwareBuffer);

    } catch (err) {
        espLoaderTerminal.writeLine(`<span style="color:red;">Error: ${err.message}</span>`);
    }
});

async function startFlashing(firmwareBuffer) {
    let port;
    try {
        port = await navigator.serial.requestPort();
        const transport = new Transport(port, true);
        
        const loaderOptions = {
            transport: transport,
            baudrate: 460800,
            terminal: espLoaderTerminal,
            debugLogging: false
        };

        const esploader = new ESPLoader(loaderOptions);
        await esploader.main(); 

        const flashAddress = 0x0000; 

        const flashOptions = {
            fileArray: [{ data: firmwareBuffer, address: flashAddress }],
            flashSize: "keep",
            eraseAll: false,
            compress: true,
            reportProgress: (fileIndex, written, total) => {
                const percent = ((written / total) * 100).toFixed(1);
                espLoaderTerminal.writeLine(`Flashing: ${percent}%`);
            }
        };

        espLoaderTerminal.writeLine("Writing firmware to flash memory...");
        await esploader.writeFlash(flashOptions);
        espLoaderTerminal.writeLine("Flashing complete!");

        await esploader.after("hard_reset");
        espLoaderTerminal.writeLine("Device reset! New firmware is now running.");

    } catch (err) {
        espLoaderTerminal.writeLine(`<span style="color:red;">Hardware Error: ${err.message}</span>`);
        console.error(err);
    }
}

amount.addEventListener('input', ()=> amountVal.textContent = amount.value);
redBias.addEventListener('input', ()=> redBiasVal.textContent = redBias.value);

function updateModeUI(){
  const m = modeSel.value;
  const diffusion = (m==='floyd'||m==='atkinson'||m==='jjn');
  serpentineField.style.display = diffusion ? '' : 'none';
  amountField.style.display = (m==='ordered'||m==='random') ? '' : 'none';
  const label = amountField.querySelector('label');
  label.firstChild.textContent = (m==='ordered') ? 'Pattern spread ' : 'Noise amount ';
}
modeSel.addEventListener('change', updateModeUI);
updateModeUI();

fileInput.addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const img = new Image();
  img.onload = ()=>{
    loadedImg = img;
    runBtn.disabled = false;
    useOriginalSize.disabled = false;
    if(!outW.value || !outH.value){
      outW.value = img.naturalWidth;
      outH.value = img.naturalHeight;
    }
    drawResizedSource();
  };
  img.src = URL.createObjectURL(file);
});

useOriginalSize.addEventListener('click', ()=>{
  if(!loadedImg) return;
  outW.value = loadedImg.naturalWidth;
  outH.value = loadedImg.naturalHeight;
  drawResizedSource();
});

function computeTargetSize(){
  let w = Math.max(1, parseInt(outW.value)||1);
  let h = Math.max(1, parseInt(outH.value)||1);
  if(keepAspect.checked && loadedImg){
    const scale = Math.min(w/loadedImg.naturalWidth, h/loadedImg.naturalHeight);
    w = Math.max(1, Math.round(loadedImg.naturalWidth*scale));
    h = Math.max(1, Math.round(loadedImg.naturalHeight*scale));
  }
  return {w,h};
}

function drawResizedSource(){
  if(!loadedImg) return;
  const {w,h} = computeTargetSize();
  srcCanvas.width = w; srcCanvas.height = h;
  const ctx = srcCanvas.getContext('2d');
  ctx.imageSmoothingEnabled = !pixelArt.checked;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0,0,w,h);
  ctx.drawImage(loadedImg, 0, 0, w, h);
}
[outW,outH,keepAspect,pixelArt].forEach(el=> el.addEventListener('input', drawResizedSource));
[outW,outH,keepAspect,pixelArt].forEach(el=> el.addEventListener('change', drawResizedSource));

function distSq(a,b){
  const dr=a[0]-b[0], dg=a[1]-b[1], db=a[2]-b[2];
  return dr*dr+dg*dg+db*db;
}

function nearestIndexBiased(r,g,b, biasAmount){
  let best=-1, bestD=Infinity;
  for(let i=0;i<PALETTE.length;i++){
    let d = distSq([r,g,b], PALETTE[i].rgb);
    if(PALETTE[i].name==='red') d -= biasAmount*40; 
    if(d<bestD){bestD=d; best=i;}
  }
  return best;
}

function ditherThreshold(data, w, h, biasAmount){
  const idxBuf = new Uint8Array(w*h);
  for(let p=0;p<w*h;p++){
    const r=data[p*3], g=data[p*3+1], b=data[p*3+2];
    idxBuf[p] = nearestIndexBiased(r,g,b, biasAmount);
  }
  return idxBuf;
}

function ditherErrorDiffusion(data, w, h, kernel, useSerpentine, biasAmount){
  const idxBuf = new Uint8Array(w*h);
  const clamp = v => v<0?0:(v>255?255:v);
  for(let y=0;y<h;y++){
    const ltr = !useSerpentine || (y%2===0);
    for(let xi=0;xi<w;xi++){
      const x = ltr ? xi : (w-1-xi);
      const p = y*w+x;
      const r = clamp(data[p*3]), g = clamp(data[p*3+1]), b = clamp(data[p*3+2]);
      const ci = nearestIndexBiased(r,g,b, biasAmount);
      idxBuf[p] = ci;
      const pc = PALETTE[ci].rgb;
      const er=r-pc[0], eg=g-pc[1], eb=b-pc[2];
      for(const [dx,dy,wt] of kernel){
        const adx = ltr ? dx : -dx;
        const nx = x+adx, ny = y+dy;
        if(nx>=0 && nx<w && ny>=0 && ny<h){
          const np = (ny*w+nx)*3;
          data[np]   += er*wt;
          data[np+1] += eg*wt;
          data[np+2] += eb*wt;
        }
      }
    }
  }
  return idxBuf;
}

const KERNELS = {
  floyd: [[1,0,7/16],[-1,1,3/16],[0,1,5/16],[1,1,1/16]],
  atkinson: [[1,0,1/8],[2,0,1/8],[-1,1,1/8],[0,1,1/8],[1,1,1/8],[0,2,1/8]],
  jjn: [
    [1,0,7/48],[2,0,5/48],
    [-2,1,3/48],[-1,1,5/48],[0,1,7/48],[1,1,5/48],[2,1,3/48],
    [-2,2,1/48],[-1,2,3/48],[0,2,5/48],[1,2,3/48],[2,2,1/48]
  ]
};

const BAYER4 = [
  [0,8,2,10],
  [12,4,14,6],
  [3,11,1,9],
  [15,7,13,5]
];

function ditherOrdered(data, w, h, spread, biasAmount){
  const idxBuf = new Uint8Array(w*h);
  const clamp = v => v<0?0:(v>255?255:v);
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const p = y*w+x;
      const t = (BAYER4[y%4][x%4]/16 - 0.5) * spread;
      const r = clamp(data[p*3]+t), g = clamp(data[p*3+1]+t), b = clamp(data[p*3+2]+t);
      idxBuf[p] = nearestIndexBiased(r,g,b, biasAmount);
    }
  }
  return idxBuf;
}

function ditherRandom(data, w, h, amt, biasAmount){
  const idxBuf = new Uint8Array(w*h);
  const clamp = v => v<0?0:(v>255?255:v);
  for(let p=0;p<w*h;p++){
    const t = (Math.random()-0.5)*amt*2;
    const r = clamp(data[p*3]+t), g = clamp(data[p*3+1]+t), b = clamp(data[p*3+2]+t);
    idxBuf[p] = nearestIndexBiased(r,g,b, biasAmount);
  }
  return idxBuf;
}

function runDither(){
  if(!loadedImg) return;
  const {w,h} = computeTargetSize();
  drawResizedSource();

  const ctx = srcCanvas.getContext('2d');
  const imgData = ctx.getImageData(0,0,w,h);
  const data = new Float32Array(w*h*3);
  for(let p=0;p<w*h;p++){
    const a = imgData.data[p*4+3]/255;
    data[p*3]   = imgData.data[p*4]   * a + 255*(1-a);
    data[p*3+1] = imgData.data[p*4+1] * a + 255*(1-a);
    data[p*3+2] = imgData.data[p*4+2] * a + 255*(1-a);
  }

  const mode = modeSel.value;
  const biasAmount = parseInt(redBias.value);
  let idxBuf;
  if(mode==='threshold'){
    idxBuf = ditherThreshold(data, w, h, biasAmount);
  } else if(mode==='ordered'){
    idxBuf = ditherOrdered(data, w, h, parseInt(amount.value), biasAmount);
  } else if(mode==='random'){
    idxBuf = ditherRandom(data, w, h, parseInt(amount.value), biasAmount);
  } else {
    idxBuf = ditherErrorDiffusion(data, w, h, KERNELS[mode], serpentine.checked, biasAmount);
  }

  lastIndexBuffer = idxBuf; lastW = w; lastH = h;

  outCanvas.width = w; outCanvas.height = h;
  const octx = outCanvas.getContext('2d');
  const outData = octx.createImageData(w,h);
  let counts = {black:0, white:0, red:0};
  for(let p=0;p<w*h;p++){
    const c = PALETTE[idxBuf[p]];
    outData.data[p*4]   = c.rgb[0];
    outData.data[p*4+1] = c.rgb[1];
    outData.data[p*4+2] = c.rgb[2];
    outData.data[p*4+3] = 255;
    counts[c.name]++;
  }
  octx.putImageData(outData,0,0);

  if (itemSelector.value === 'custom') {
    const layoutW = srcCanvas.clientWidth || srcCanvas.width;
    const layoutH = srcCanvas.clientHeight || srcCanvas.height;
    
    mockupContainer.style.width = layoutW + 'px';
    mockupContainer.style.height = layoutH + 'px';
  }

  const total = w*h;
  stats.innerHTML = `${w}×${h}px — `+
    `<span class="dot" style="background:#000;border:1px solid #444"></span>black ${(counts.black/total*100).toFixed(1)}%  `+
    `<span class="dot" style="background:#fff"></span>white ${(counts.white/total*100).toFixed(1)}%  `+
    `<span class="dot" style="background:#ff3b30"></span>red ${(counts.red/total*100).toFixed(1)}%`;

  emptyMsg.style.display = 'none';
  arraySection.style.display = '';
  generateOutput();
}
runBtn.addEventListener('click', runDither);

function toCBytes(bytes){
  let lines = [];
  for(let i=0;i<bytes.length;i+=16){
    const chunk = bytes.slice(i, i+16);
    lines.push('  '+Array.from(chunk).map(b=>'0x'+b.toString(16).padStart(2,'0')).join(', ')+',');
  }
  if(lines.length){
    lines[lines.length-1] = lines[lines.length-1].replace(/,$/, '');
  }
  return lines.join('\n');
}

function generateOutput(){
  if(!lastIndexBuffer) return;
  const w = lastW, h = lastH, idx = lastIndexBuffer;
  const fmt = formatSel.value;
  let text = '';
  const now = new Date().toISOString();

  if(fmt==='planes'){
    const rowBytes = Math.ceil(w/8);
    const bw = new Uint8Array(rowBytes*h);
    const red = new Uint8Array(rowBytes*h);
    for(let y=0;y<h;y++){
      for(let x=0;x<w;x++){
        const p = y*w+x;
        const name = PALETTE[idx[p]].name;
        const byteIdx = y*rowBytes + (x>>3);
        const bitPos = 7-(x%8);
        const bwBit  = (name==='black') ? 0 : 1;
        const redBit = (name==='red')   ? 0 : 1;
        if(bwBit)  bw[byteIdx]  |= (1<<bitPos);
        if(redBit) red[byteIdx] |= (1<<bitPos);
      }
    }
    text += `// Generated by InkplateImageUploader — ${now}\n`;
    text += `// Image: ${w} x ${h} px, mode: ${modeSel.options[modeSel.selectedIndex].text}\n`;
    text += `// Format: 2 bitplanes, MSB-first, row padded to byte boundary (${rowBytes} bytes/row)\n`;
    text += `#define IMG_WIDTH  ${w}\n#define IMG_HEIGHT ${h}\n#define IMG_ROW_BYTES ${rowBytes}\n\n`;
    text += `const unsigned char img_black[${bw.length}] = {\n${toCBytes(bw)}\n};\n\n`;
    text += `const unsigned char img_red[${red.length}] = {\n${toCBytes(red)}\n};\n`;
  } else {
    const bytes = new Uint8Array(w*h);
    for(let p=0;p<w*h;p++) bytes[p]=idx[p];
    text += `// Generated by InkplateImageUploader — ${now}\n`;
    text += `// Image: ${w} x ${h} px, mode: ${modeSel.options[modeSel.selectedIndex].text}\n`;
    text += `// Format: 1 byte per pixel, row-major, 0=black 1=white 2=red\n\n`;
    text += `#define IMG_WIDTH  ${w}\n#define IMG_HEIGHT ${h}\n\n`;
    text += `const unsigned char img_indexed[${bytes.length}] = {\n${toCBytes(bytes)}\n};\n`;
  }
  output.value = text;
}
formatSel.addEventListener('change', generateOutput);

copyBtn.addEventListener('click', ()=>{
  output.select();
  document.execCommand('copy');
  copyBtn.textContent = 'copied';
  setTimeout(()=> copyBtn.textContent='copy', 1000);
});

downloadBtn.addEventListener('click', ()=>{
  const blob = new Blob([output.value], {type:'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'image_3color.h';
  a.click();
});

async function transmitDataOverBle(payloadBuffer) {
  uploadBleBtn.disabled = true;
  updateBleLog(`Looking for devices named "${DEVICE_NAME_PREFIX}"...`);

  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: DEVICE_NAME_PREFIX }],
      optionalServices: [BLE_SERVICE_UUID] 
    });

    updateBleLog(`Connecting to ${device.name}...`);
    const server = await device.gatt.connect();

    updateBleLog("Discovering services...");
    const services = await server.getPrimaryServices();
    if (services.length === 0) throw new Error("No services found on device.");
    const service = services[0]; 

    updateBleLog("Discovering characteristics...");
    const characteristics = await service.getCharacteristics();
    const characteristic = characteristics.find(c => c.properties.write || c.properties.writeWithoutResponse);
    if (!characteristic) throw new Error("No writable characteristic found.");

    updateBleLog(`Sending metadata header...`);
    const header = new DataView(new ArrayBuffer(8));
    const w = lastW; 
    const h = lastH;

    header.setUint32(0, payloadBuffer.byteLength, true); 
    header.setUint16(4, w, true);                        
    header.setUint16(6, h, true);                        
    await characteristic.writeValueWithResponse(header);

    const CHUNK_SIZE = 240; 
    let offset = 0;

    updateBleLog("Streaming image data...");
    while (offset < payloadBuffer.byteLength) {
      const chunk = payloadBuffer.slice(offset, offset + CHUNK_SIZE);
      await characteristic.writeValueWithResponse(chunk);
      
      offset += CHUNK_SIZE;
      const progress = Math.min(100, Math.round((offset / payloadBuffer.byteLength) * 100));
      updateBleLog(`Uploading: ${progress}%`);

      await new Promise(resolve => setTimeout(resolve, 15));
    }

    updateBleLog("Upload completed successfully!");
    device.gatt.disconnect();

  } catch (error) {
    updateBleLog(`Error: ${error.message}`);
    console.error(error);
  } finally {
    uploadBleBtn.disabled = false;
  }
}

uploadBleBtn.addEventListener('click', () => {
  if (!lastIndexBuffer) {
    updateBleLog("Error: No image parsed yet to upload.");
    return;
  }

  const w = lastW, h = lastH, idx = lastIndexBuffer;
  const fmt = formatSel.value;
  const rowBytes = Math.ceil(w / 8);
  let finalPayload;

  if (fmt === 'planes') {
    const bw = new Uint8Array(rowBytes * h);
    const red = new Uint8Array(rowBytes * h);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const name = PALETTE[idx[p]].name;
        const byteIdx = y * rowBytes + (x >> 3);
        const bitPos = 7 - (x % 8);
        
        const bwBit  = (name === 'black') ? 0 : 1;
        const redBit = (name === 'red')   ? 0 : 1;
        if (bwBit)  bw[byteIdx]  |= (1 << bitPos);
        if (redBit) red[byteIdx] |= (1 << bitPos);
      }
    }

    finalPayload = new Uint8Array(bw.length + red.length);
    finalPayload.set(bw, 0);
    finalPayload.set(red, bw.length);

  } else {
    finalPayload = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) {
      finalPayload[p] = idx[p];
    }
  }

  transmitDataOverBle(finalPayload);
});