(() => {
    'use strict';

    const CANVAS_SIZE = 1200;
    const CIRCLE_CX = 600;
    const CIRCLE_CY = 599;
    const CIRCLE_R = 534;
    const MAX_PHOTO_SIDE = 4096; // downscale huge phone photos so mobile browsers don't run out of memory
    const DOWNLOAD_NAME = 'Joy_Bangla_Frame.png';

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const fileInput = document.getElementById('fileInput');
    const resetBtn = document.getElementById('resetBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const zoomValue = document.getElementById('zoomValue');
    const zoomOutBtn = document.getElementById('zoomOutBtn');
    const zoomInBtn = document.getElementById('zoomInBtn');
    const emptyHint = document.getElementById('emptyHint');
    const colorBtn = document.getElementById('colorBtn');
    const bwBtn = document.getElementById('bwBtn');

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // ─── State ───────────────────────────────────────────────────────────────────
    const state = {
        frame: null,
        frameTainted: false, // true if frame was loaded without CORS (export will be blocked)
        user: null,
        gray: null, // cached grayscale version of the user photo
        isBw: false,

        baseScale: 1,
        scale: 1,
        tx: CIRCLE_CX,
        ty: CIRCLE_CY,

        dragging: false,
        hasDragged: false,
        lastX: 0,
        lastY: 0,

        // Pinch-to-zoom
        pinchActive: false,
        pinchStartDist: 0,
        pinchStartScale: 1,
        pinchStartMidX: 0,
        pinchStartMidY: 0,
        pinchStartTx: 0,
        pinchStartTy: 0,
    };

    // ─── Load frame overlay ───────────────────────────────────────────────────────
    // Try with CORS first (keeps canvas exportable on http/https). If that fails
    // (e.g. file://), retry without CORS so the frame still shows; export will
    // then explain what to do.
    function loadFrame(useCors) {
        const img = new Image();
        if (useCors) img.crossOrigin = 'anonymous';
        img.onload = () => {
            state.frame = img;
            state.frameTainted = !useCors;
            render();
        };
        img.onerror = () => {
            if (useCors) {
                loadFrame(false);
            } else {
                toast('Could not load frame1.png');
            }
        };
        img.src = 'frame1.png';
    }
    loadFrame(true);

    // ─── Grayscale (works on every browser, unlike ctx.filter) ───────────────────
    function makeGray(img) {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height);
        const p = d.data;
        for (let i = 0; i < p.length; i += 4) {
            const y = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
            p[i] = p[i + 1] = p[i + 2] = y;
        }
        g.putImageData(d, 0, 0);
        return c;
    }

    // ─── Render ───────────────────────────────────────────────────────────────────
    function render() {
        ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

        if (state.user) {
            let src = state.user;
            if (state.isBw) {
                if (!state.gray) {
                    try {
                        state.gray = makeGray(state.user);
                    } catch (e) {
                        console.error('Grayscale failed:', e);
                        state.isBw = false;
                        toast('B&W not supported for this photo');
                    }
                }
                if (state.gray) src = state.gray;
            }
            const s = state.baseScale * state.scale;
            const dw = src.width * s;
            const dh = src.height * s;
            ctx.drawImage(src, state.tx - dw / 2, state.ty - dh / 2, dw, dh);
        } else {
            // placeholder disc so the frame cutout is visible before upload
            ctx.fillStyle = '#2a2e2c';
            ctx.beginPath();
            ctx.arc(CIRCLE_CX, CIRCLE_CY, CIRCLE_R, 0, Math.PI * 2);
            ctx.fill();
        }

        if (state.frame) {
            ctx.drawImage(state.frame, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
        }
    }

    // ─── Load user photo ──────────────────────────────────────────────────────────
    async function loadUserPhoto(file) {
        // file.type can be empty on some Android phones, so only reject when it is
        // clearly NOT an image.
        if (!file || (file.type && !file.type.startsWith('image/'))) {
            toast('Please pick an image file');
            return;
        }

        let bitmap = null;
        try {
            bitmap = await createImageBitmap(file, {
                imageOrientation: 'from-image'
            });
        } catch (_) {
            try {
                bitmap = await loadAsImage(file);
            } catch (err) {
                console.error('Image load failed:', err);
                toast('Could not open this photo. Try JPG or PNG.');
                return;
            }
        }

        // Downscale very large photos
        const big = Math.max(bitmap.width, bitmap.height);
        if (big > MAX_PHOTO_SIDE) {
            try {
                const k = MAX_PHOTO_SIDE / big;
                const c = document.createElement('canvas');
                c.width = Math.round(bitmap.width * k);
                c.height = Math.round(bitmap.height * k);
                const g = c.getContext('2d');
                g.imageSmoothingQuality = 'high';
                g.drawImage(bitmap, 0, 0, c.width, c.height);
                bitmap = c;
            } catch (err) {
                console.error('Downscale failed:', err);
            }
        }

        state.user = bitmap;
        state.gray = null;
        const minSide = Math.min(bitmap.width, bitmap.height);
        state.baseScale = (CIRCLE_R * 2) / minSide;
        state.scale = 1;
        state.tx = CIRCLE_CX;
        state.ty = CIRCLE_CY;

        zoomValue.textContent = '100%';
        zoomOutBtn.disabled = false;
        zoomInBtn.disabled = false;
        resetBtn.disabled = false;
        downloadBtn.disabled = false;
        emptyHint.classList.add('hidden');
        canvas.classList.remove('empty');
        render();
    }

    function loadAsImage(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                resolve(img);
            };
            img.onerror = (e) => {
                URL.revokeObjectURL(url);
                reject(e);
            };
            img.src = url;
        });
    }

    // ─── Coordinate helper ────────────────────────────────────────────────────────
    function clientToCanvas(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const ratio = CANVAS_SIZE / rect.width;
        return {
            x: (clientX - rect.left) * ratio,
            y: (clientY - rect.top) * ratio,
        };
    }

    // ─── Touch events ─────────────────────────────────────────────────────────────
    canvas.addEventListener('touchstart', (e) => {
        if (!state.user) return; // let the tap fall through to the click handler

        if (e.touches.length === 1) {
            e.preventDefault();
            state.dragging = true;
            state.hasDragged = false;
            state.pinchActive = false;
            canvas.classList.add('dragging');
            state.lastX = e.touches[0].clientX;
            state.lastY = e.touches[0].clientY;

        } else if (e.touches.length === 2) {
            e.preventDefault();
            state.dragging = false;
            state.pinchActive = true;

            const t1 = e.touches[0],
                t2 = e.touches[1];
            state.pinchStartDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
            state.pinchStartScale = state.scale;

            const mid = clientToCanvas(
                (t1.clientX + t2.clientX) / 2,
                (t1.clientY + t2.clientY) / 2,
            );
            state.pinchStartMidX = mid.x;
            state.pinchStartMidY = mid.y;
            state.pinchStartTx = state.tx;
            state.pinchStartTy = state.ty;
        }
    }, {
        passive: false
    });

    canvas.addEventListener('touchmove', (e) => {
        if (!state.user) return;

        if (state.pinchActive && e.touches.length === 2) {
            e.preventDefault();

            const t1 = e.touches[0],
                t2 = e.touches[1];
            const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
            const factor = dist / (state.pinchStartDist || 1);
            const newScale = clamp(state.pinchStartScale * factor, 0.2, 3.0);

            const scaleRatio = newScale / state.pinchStartScale;
            state.tx = state.pinchStartMidX + (state.pinchStartTx - state.pinchStartMidX) * scaleRatio;
            state.ty = state.pinchStartMidY + (state.pinchStartTy - state.pinchStartMidY) * scaleRatio;

            setScale(newScale);

        } else if (state.dragging && e.touches.length === 1) {
            e.preventDefault();

            const p = e.touches[0];
            const cur = clientToCanvas(p.clientX, p.clientY);
            const last = clientToCanvas(state.lastX, state.lastY);
            state.tx += cur.x - last.x;
            state.ty += cur.y - last.y;
            state.lastX = p.clientX;
            state.lastY = p.clientY;
            state.hasDragged = true;
            render();
        }
    }, {
        passive: false
    });

    canvas.addEventListener('touchend', (e) => {
        if (e.touches.length === 0) {
            state.dragging = false;
            state.pinchActive = false;
            canvas.classList.remove('dragging');
        } else if (e.touches.length === 1 && state.pinchActive) {
            // finger lifted during pinch — switch back to single-finger drag
            state.pinchActive = false;
            state.dragging = true;
            state.lastX = e.touches[0].clientX;
            state.lastY = e.touches[0].clientY;
        }
    });

    canvas.addEventListener('touchcancel', () => {
        state.dragging = false;
        state.pinchActive = false;
        canvas.classList.remove('dragging');
    });

    // ─── Mouse events ─────────────────────────────────────────────────────────────
    canvas.addEventListener('mousedown', (e) => {
        if (!state.user) return; // empty state: the click handler opens the picker (once)
        state.dragging = true;
        state.hasDragged = false;
        canvas.classList.add('dragging');
        state.lastX = e.clientX;
        state.lastY = e.clientY;
    });

    window.addEventListener('mousemove', (e) => {
        if (!state.dragging || !state.user) return;
        const cur = clientToCanvas(e.clientX, e.clientY);
        const last = clientToCanvas(state.lastX, state.lastY);
        state.tx += cur.x - last.x;
        state.ty += cur.y - last.y;
        state.lastX = e.clientX;
        state.lastY = e.clientY;
        state.hasDragged = true;
        render();
    });

    window.addEventListener('mouseup', () => {
        state.dragging = false;
        canvas.classList.remove('dragging');
    });

    // Open the file picker only when no photo is loaded
    canvas.addEventListener('click', () => {
        if (!state.user) fileInput.click();
        state.hasDragged = false;
    });

    canvas.classList.add('empty');

    // ─── Scroll / wheel zoom ──────────────────────────────────────────────────────
    canvas.addEventListener('wheel', (e) => {
        if (!state.user) return;
        e.preventDefault();
        setScale(state.scale * (1 + (-e.deltaY * 0.0015)));
    }, {
        passive: false
    });

    // ─── File input ───────────────────────────────────────────────────────────────
    fileInput.addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) loadUserPhoto(f);
        e.target.value = ''; // allow re-selecting the same file
    });

    // ─── Drag-and-drop ────────────────────────────────────────────────────────────
    ['dragenter', 'dragover'].forEach(ev => {
        canvas.addEventListener(ev, (e) => {
            e.preventDefault();
            e.stopPropagation();
            canvas.parentElement.classList.add('dragover');
        });
    });
    ['dragleave', 'dragend'].forEach(ev => {
        canvas.addEventListener(ev, () => {
            canvas.parentElement.classList.remove('dragover');
        });
    });
    canvas.addEventListener('drop', (e) => {
        e.preventDefault();
        canvas.parentElement.classList.remove('dragover');
        const f = e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) loadUserPhoto(f);
    });

    // ─── Zoom buttons ─────────────────────────────────────────────────────────────
    zoomOutBtn.addEventListener('click', () => {
        if (!state.user) return;
        setScale(state.scale - 0.1);
    });
    zoomInBtn.addEventListener('click', () => {
        if (!state.user) return;
        setScale(state.scale + 0.1);
    });

    // ─── Filter buttons ───────────────────────────────────────────────────────────
    if (colorBtn) colorBtn.addEventListener('click', () => {
        state.isBw = false;
        colorBtn.classList.add('active');
        if (bwBtn) bwBtn.classList.remove('active');
        render();
    });
    if (bwBtn) bwBtn.addEventListener('click', () => {
        state.isBw = true;
        bwBtn.classList.add('active');
        if (colorBtn) colorBtn.classList.remove('active');
        render();
    });

    // ─── Reset button ─────────────────────────────────────────────────────────────
    resetBtn.addEventListener('click', () => {
        if (!state.user) return;
        state.scale = 1;
        state.tx = CIRCLE_CX;
        state.ty = CIRCLE_CY;
        zoomValue.textContent = '100%';
        render();
    });

    // ─── Download button ─────────────────────────────────────────────────────────
    function canvasToBlob() {
        return new Promise((resolve, reject) => {
            try {
                canvas.toBlob((blob) => {
                    blob ? resolve(blob) : reject(new Error('Empty blob'));
                }, 'image/png');
            } catch (err) {
                reject(err); // SecurityError when canvas is tainted
            }
        });
    }

    function isMobile() {
        return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    function isInAppBrowser() {
        return /FBAN|FBAV|FB_IAB|Messenger|Instagram|Line\/|MicroMessenger|Snapchat/i.test(navigator.userAgent);
    }

    downloadBtn.addEventListener('click', async () => {
        if (!state.user) return;

        let blob;
        try {
            blob = await canvasToBlob();
        } catch (err) {
            console.error('Export error:', err);
            if (err && err.name === 'SecurityError') {
                toast('Blocked: open this page via https (not file://)');
            } else {
                toast('Download failed — try a different browser');
            }
            return;
        }

        const file = new File([blob], DOWNLOAD_NAME, {
            type: 'image/png'
        });

        // Phones: share sheet lets the user "Save Image" / save to gallery
        if (isMobile() && navigator.canShare && navigator.canShare({
                files: [file]
            })) {
            try {
                await navigator.share({
                    files: [file]
                });
                toast('Saved ✓');
                return;
            } catch (e) {
                if (e && e.name === 'AbortError') return; // user closed the sheet
                // otherwise fall through to normal download
            }
        }

        // Facebook/Messenger/Instagram in-app browsers block downloads
        if (isInAppBrowser()) {
            toast('Open this page in Chrome or Safari to download');
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = DOWNLOAD_NAME;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        if (!isInAppBrowser()) toast('Downloaded ✓');
    });

    // ─── Helpers ──────────────────────────────────────────────────────────────────
    function setScale(newScale) {
        state.scale = clamp(newScale, 0.2, 3.0);
        zoomValue.textContent = Math.round(state.scale * 100) + '%';
        render();
    }

    function clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }

    // ─── Toast notification ───────────────────────────────────────────────────────
    let toastEl = null,
        toastTimer = 0;

    function toast(msg) {
        if (!toastEl) {
            toastEl = document.createElement('div');
            toastEl.className = 'toast';
            document.body.appendChild(toastEl);
        }
        toastEl.textContent = msg;
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
    }

    // Prevent accidental double-tap zoom on the whole page
    document.addEventListener('dblclick', (e) => e.preventDefault(), {
        passive: false
    });

    // ─── Initial render ───────────────────────────────────────────────────────────
    render();
})();
