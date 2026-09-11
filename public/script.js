// ============ 全局状态 ============
let currentFileForRename = null;
let currentFileForMove = null;
let lastInputId = null;
let currentView = 'grid'; // grid | list
let currentDir = '';      // 当前浏览的目录
let pendingFiles = [];    // 待上传文件
let confirmCallback = null;
let storageQuota = 10 * 1024 * 1024 * 1024; // 存储配额，默认 10 GB，启动时从服务端获取

// ============ 工具函数 ============
function getFileIcon(name, isDirectory) {
    if (isDirectory) return '📁';
    const ext = name.split('.').pop().toLowerCase();
    if (["mp4","webm","ogg","mov","m4v","avi"].includes(ext)) return '🎬';
    if (["mp3","wav","aac","flac","m4a"].includes(ext)) return '🎵';
    if (["jpg","jpeg","png","gif","bmp","webp","svg"].includes(ext)) return '🖼️';
    if (["doc","docx","pdf","xls","xlsx","ppt","pptx","txt","md","csv"].includes(ext)) return '📄';
    if (["zip","rar","7z","tar","gz"].includes(ext)) return '🗜️';
    if (["json","yaml","toml"].includes(ext)) return '🧾';
    return '📦';
}

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

function parseSize(sizeStr) {
    if (typeof sizeStr === 'number') return sizeStr;
    if (!sizeStr) return 0;
    const m = String(sizeStr).match(/([\d.]+)\s*(B|KB|MB|GB|TB)/i);
    if (!m) return 0;
    const val = parseFloat(m[1]);
    const unit = m[2].toUpperCase();
    const mult = { 'B': 1, 'KB': 1024, 'MB': 1024**2, 'GB': 1024**3, 'TB': 1024**4 };
    return val * (mult[unit] || 1);
}

function utf8ToBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
}

// ============ Toast ============
function showToast(msg, duration = 2000, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = 'toast ' + type;
    toast.style.display = 'block';
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => { toast.style.display = 'none'; }, 300);
    }, duration);
}

// ============ 确认弹窗 ============
function showConfirm(title, message, onOk) {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    confirmCallback = onOk;
    document.getElementById('confirmModal').style.display = 'block';
}
function closeConfirmModal(ok) {
    document.getElementById('confirmModal').style.display = 'none';
    if (ok && confirmCallback) confirmCallback();
    confirmCallback = null;
}

// ============ 面包屑 ============
function renderBreadcrumb() {
    const bc = document.getElementById('breadcrumb');
    const val = currentDir;
    bc.innerHTML = '';
    const root = document.createElement('span');
    root.className = 'crumb' + (val === '' ? ' active' : '');
    root.textContent = '我的文件';
    root.onclick = () => navigateTo('');
    bc.appendChild(root);
    if (val) {
        const parts = val.split('/');
        let acc = '';
        parts.forEach((p, i) => {
            acc = acc ? acc + '/' + p : p;
            const sep = document.createElement('span');
            sep.className = 'crumb-sep';
            sep.textContent = '›';
            bc.appendChild(sep);
            const c = document.createElement('span');
            const isLast = i === parts.length - 1;
            c.className = 'crumb' + (isLast ? ' active' : '');
            c.textContent = p;
            const path = acc;
            c.onclick = () => navigateTo(path);
            bc.appendChild(c);
        });
    }
}

// ============ 侧边栏导航 ============
function navigateTo(dir) {
    currentDir = dir;
    // 更新侧边栏高亮
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.dir === dir);
    });
    renderBreadcrumb();
    fetchFiles();
    // 移动端点击后收起侧边栏
    closeSidebar();
}

// ============ 侧边栏开合（移动端） ============
function setupSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebarToggle');
    let backdrop = document.querySelector('.sidebar-backdrop');
    if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.className = 'sidebar-backdrop';
        document.body.appendChild(backdrop);
    }
    toggle.onclick = () => {
        const open = sidebar.classList.toggle('open');
        backdrop.classList.toggle('show', open);
    };
    backdrop.onclick = closeSidebar;
}
function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.querySelector('.sidebar-backdrop');
    if (sidebar) sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('show');
}

// ============ 视图切换 ============
function toggleView() {
    currentView = currentView === 'grid' ? 'list' : 'grid';
    applyView();
}
function applyView() {
    const grid = document.getElementById('fileGrid');
    const list = document.getElementById('listView');
    const iconGrid = document.getElementById('iconGrid');
    const iconList = document.getElementById('iconList');
    if (currentView === 'grid') {
        grid.style.display = '';
        list.style.display = 'none';
        iconGrid.style.display = 'none';
        iconList.style.display = '';
    } else {
        grid.style.display = 'none';
        list.style.display = '';
        iconGrid.style.display = '';
        iconList.style.display = 'none';
    }
}

// ============ 获取文件列表 ============
async function fetchFiles() {
    try {
        const filterSubdir = currentDir;
        document.getElementById('backBtn').style.display = filterSubdir ? '' : 'none';
        const url = filterSubdir ? `/api/files?subdir=${encodeURIComponent(filterSubdir)}` : '/api/files';
        const response = await fetch(url);
        const files = await response.json();
        const tableBody = document.querySelector('#fileTable tbody');
        const grid = document.getElementById('fileGrid');
        tableBody.innerHTML = '';
        grid.innerHTML = '';

        if (files.length === 0) {
            const emptyHtml = `
                <div class="empty-state">
                    <div class="empty-icon">📂</div>
                    <p>没有找到文件，去上传一个吧</p>
                </div>`;
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 7;
            cell.innerHTML = emptyHtml;
            tableBody.appendChild(row);
            grid.innerHTML = emptyHtml;
            updateStorageRing([]);
            return;
        }

        const folderOrder = ['videos', 'audios', 'pictures', 'documents', 'others'];
        files.sort((a, b) => {
            if (a.isDirectory && b.isDirectory) {
                return folderOrder.indexOf(a.name) - folderOrder.indexOf(b.name);
            } else if (a.isDirectory) return -1;
            else if (b.isDirectory) return 1;
            return 0;
        });

        window.currentFiles = files;
        updateStorageRing(files);

        files.forEach((file, idx) => {
            const icon = getFileIcon(file.name, file.isDirectory);
            const sizeText = file.isDirectory ? '—' : file.size;
            const dateText = new Date(file.lastModified).toLocaleString();

            // ---- 列表行 ----
            const row = document.createElement('tr');
            const checkboxCell = document.createElement('td');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'row-checkbox';
            checkbox.dataset.index = idx;
            checkbox.onclick = (e) => {
                e.stopPropagation();
                row.classList.toggle('row-selected', checkbox.checked);
                updateBatchToolbar();
            };
            checkboxCell.appendChild(checkbox);
            row.appendChild(checkboxCell);

            const nameCell = document.createElement('td');
            const nameWrap = document.createElement('div');
            nameWrap.className = 'file-name-cell';
            const iconSpan = document.createElement('span');
            iconSpan.className = 'file-icon-sm';
            iconSpan.textContent = icon;
            nameWrap.appendChild(iconSpan);

            if (file.isDirectory) {
                const folderLink = document.createElement('a');
                folderLink.className = 'folder-link';
                folderLink.textContent = file.name + '/';
                folderLink.href = '#';
                folderLink.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    navigateTo(filterSubdir ? filterSubdir + '/' + file.name : file.name);
                };
                nameWrap.appendChild(folderLink);
            } else {
                const link = document.createElement('a');
                link.href = file.downloadUrl;
                link.textContent = file.name;
                link.className = 'file-link';
                link.target = '_blank';
                link.onclick = (e) => {
                    const ext = file.name.split('.').pop().toLowerCase();
                    const mediaExts = ['jpg','jpeg','png','gif','bmp','webp','svg','mp4','webm','ogg','mov','m4v','avi','mp3','wav','aac','flac','m4a'];
                    if (mediaExts.includes(ext)) {
                        e.preventDefault();
                        window.open(file.downloadUrl, '_blank');
                    }
                };
                nameWrap.appendChild(link);
            }
            nameCell.appendChild(nameWrap);
            row.appendChild(nameCell);

            const dirCell = document.createElement('td');
            dirCell.textContent = file.subdir || '根目录';
            row.appendChild(dirCell);

            const typeCell = document.createElement('td');
            const badge = document.createElement('span');
            badge.className = file.isDirectory ? 'badge-dir' : 'badge-file';
            badge.textContent = file.isDirectory ? '文件夹' : '文件';
            typeCell.appendChild(badge);
            row.appendChild(typeCell);

            const sizeCell = document.createElement('td');
            sizeCell.className = 'size-text';
            sizeCell.textContent = sizeText;
            row.appendChild(sizeCell);

            const dateCell = document.createElement('td');
            dateCell.className = 'date-text';
            dateCell.textContent = dateText;
            row.appendChild(dateCell);

            const actionCell = document.createElement('td');
            const actionBtn = document.createElement('button');
            actionBtn.textContent = '⋯';
            actionBtn.className = 'action-btn';
            actionBtn.onclick = (e) => { e.stopPropagation(); showActionMenu(e, file); };
            actionCell.appendChild(actionBtn);
            row.appendChild(actionCell);
            tableBody.appendChild(row);

            // ---- 网格卡片 ----
            const card = document.createElement('div');
            card.className = 'file-card';
            card.innerHTML = `
                <input type="checkbox" class="row-checkbox card-check" data-index="${idx}">
                <button class="action-btn card-more" title="更多操作">⋯</button>
                <div class="card-icon">${icon}</div>
                <a class="card-name" ${file.isDirectory ? 'href="#"' : `href="${file.downloadUrl}" target="_blank"`}>${escapeHtml(file.name)}</a>
                <div class="card-meta">${file.isDirectory ? '文件夹' : sizeText}</div>
            `;
            const cardCheck = card.querySelector('.card-check');
            cardCheck.onclick = (e) => {
                e.stopPropagation();
                card.classList.toggle('selected', cardCheck.checked);
                updateBatchToolbar();
            };
            card.querySelector('.card-more').onclick = (e) => {
                e.stopPropagation();
                showActionMenu(e, file);
            };
            const cardName = card.querySelector('.card-name');
            cardName.onclick = (e) => {
                if (file.isDirectory) {
                    e.preventDefault();
                    navigateTo(filterSubdir ? filterSubdir + '/' + file.name : file.name);
                }
            };
            grid.appendChild(card);
        });

        // 全选逻辑
        const selectAll = document.getElementById('selectAll');
        selectAll.checked = false;
        selectAll.onclick = function() {
            const checkboxes = document.querySelectorAll('.row-checkbox');
            checkboxes.forEach(cb => { cb.checked = selectAll.checked; });
            document.querySelectorAll('tbody tr').forEach(tr => {
                tr.classList.toggle('row-selected', selectAll.checked);
            });
            document.querySelectorAll('.file-card').forEach(c => {
                c.classList.toggle('selected', selectAll.checked);
            });
            updateBatchToolbar();
        };

        updateBatchToolbar();
    } catch (error) {
        console.error('Error fetching files:', error);
        showToast('加载文件列表失败', 2500, 'error');
    }
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}

// ============ 批量工具条 ============
function updateBatchToolbar() {
    const checkboxes = document.querySelectorAll('.row-checkbox:checked');
    const count = checkboxes.length;
    document.getElementById('batchDeleteBtn').disabled = count === 0;
    document.getElementById('batchMoveBtn').disabled = count === 0;
    const info = document.getElementById('selectionInfo');
    if (count > 0) {
        info.style.display = '';
        info.textContent = `已选择 ${count} 项`;
    } else {
        info.style.display = 'none';
    }
    const selectAll = document.getElementById('selectAll');
    const total = document.querySelectorAll('.row-checkbox').length;
    selectAll.checked = total > 0 && count === total;
}

// ============ 操作菜单 ============
function showActionMenu(event, file) {
    const existingMenu = document.querySelector('.action-menu');
    if (existingMenu) existingMenu.remove();

    const menu = document.createElement('div');
    menu.className = 'action-menu';
    document.body.appendChild(menu);

    const items = [
        { label: '⬇️ 下载', cls: '', fn: () => window.open(file.downloadUrl, '_blank') },
        { label: '✏️ 重命名', cls: '', fn: () => showRenameModal(file) },
        { label: '📦 移动', cls: '', fn: () => showMoveModal(file) },
        { label: '🗑️ 删除', cls: 'delete', fn: () => deleteFile(file) },
    ];
    items.forEach(it => {
        const div = document.createElement('div');
        div.textContent = it.label;
        div.className = 'menu-item ' + it.cls;
        div.onclick = () => { menu.remove(); it.fn(); };
        menu.appendChild(div);
    });

    const rect = event.target.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = rect.bottom + 'px';
    menu.style.left = rect.left + 'px';
    menu.style.zIndex = '1000';

    setTimeout(() => {
        const menuRect = menu.getBoundingClientRect();
        if (menuRect.bottom > window.innerHeight) {
            menu.style.top = (window.innerHeight - menuRect.height - 10) + 'px';
        }
        if (menuRect.right > window.innerWidth) {
            menu.style.left = (window.innerWidth - menuRect.width - 10) + 'px';
        }
    }, 0);

    setTimeout(() => {
        document.addEventListener('click', function closeMenu(e) {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        });
    }, 0);
}

// ============ 重命名 ============
function showRenameModal(file) {
    currentFileForRename = file;
    const modal = document.getElementById('renameModal');
    const input = document.getElementById('newFileName');
    input.value = file.name;
    modal.style.display = 'block';
    input.focus();
}

async function confirmRename() {
    if (!currentFileForRename) return;
    const newName = document.getElementById('newFileName').value.trim();
    if (!newName) {
        showToast('请输入文件名', 2000, 'error');
        return;
    }
    try {
        const oldPath = currentFileForRename.subdir === '根目录' ?
            currentFileForRename.name :
            `${currentFileForRename.subdir}/${currentFileForRename.name}`;
        const response = await fetch('/api/files/rename', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldPath, newName })
        });
        const result = await response.json();
        if (response.ok) {
            showToast('重命名成功');
            closeRenameModal();
            fetchFiles();
        } else {
            showToast('错误: ' + (result.error || '重命名失败'), 3000, 'error');
        }
    } catch (error) {
        console.error('Rename error:', error);
        showToast('重命名失败', 3000, 'error');
    }
}

function closeRenameModal() {
    document.getElementById('renameModal').style.display = 'none';
}

// ============ 移动 ============
function showMoveModal(file) {
    currentFileForMove = file;
    const modal = document.getElementById('moveModal');
    const select = document.getElementById('moveTargetDir');
    fetch('/api/subdirs').then(r => r.json()).then(subdirs => {
        select.innerHTML = '';
        const rootOpt = document.createElement('option');
        rootOpt.value = '';
        rootOpt.textContent = '根目录';
        if (!file.subdir || file.subdir === '根目录') rootOpt.disabled = true;
        select.appendChild(rootOpt);
        subdirs.forEach(dir => {
            if (file.subdir !== dir) {
                const opt = document.createElement('option');
                opt.value = dir;
                opt.textContent = dir;
                select.appendChild(opt);
            }
        });
    });
    modal.style.display = 'block';
    const btn = modal.querySelector('.modal-actions button:last-child');
    if (btn) btn.onclick = confirmMove;
}

function confirmMove() {
    if (!currentFileForMove) return;
    const targetDir = document.getElementById('moveTargetDir').value;
    const oldPath = currentFileForMove.subdir === '根目录' ? currentFileForMove.name : `${currentFileForMove.subdir}/${currentFileForMove.name}`;
    fetch('/api/files/move', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath, targetDir })
    }).then(r => r.json()).then(result => {
        if (result && result.message) {
            showToast('移动成功');
            closeMoveModal();
            fetchFiles();
        } else {
            showToast('移动失败: ' + (result.error || ''), 3000, 'error');
        }
    }).catch(() => showToast('移动失败', 3000, 'error'));
}

function closeMoveModal() {
    document.getElementById('moveModal').style.display = 'none';
}

// ============ 删除 ============
async function deleteFile(file, silent = false) {
    const doDelete = async () => {
        try {
            const filePath = file.subdir === '根目录' ? file.name : `${file.subdir}/${file.name}`;
            const response = await fetch('/api/files/' + encodeURIComponent(filePath), {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' }
            });
            const result = await response.json();
            if (response.ok) {
                showToast('删除成功');
                fetchFiles();
            } else {
                showToast('错误: ' + (result.error || '删除失败'), 3000, 'error');
            }
        } catch (error) {
            console.error('Delete error:', error);
            showToast('删除失败', 3000, 'error');
        }
    };
    if (silent) { await doDelete(); return; }
    showConfirm('删除确认', `确定要删除 "${file.name}" 吗？此操作不可恢复。`, doDelete);
}

// ============ 批量操作 ============
async function batchDelete() {
    const checked = Array.from(document.querySelectorAll('.row-checkbox:checked'));
    if (checked.length === 0) return;
    const files = checked.map(cb => window.currentFiles[cb.dataset.index]).filter(f => f && !f.isDirectory);
    showConfirm('批量删除', `确定要删除选中的 ${files.length} 个文件吗？此操作不可恢复。`, async () => {
        for (const file of files) {
            await deleteFile(file, true);
        }
        fetchFiles();
    });
}

function batchMove() {
    const checked = Array.from(document.querySelectorAll('.row-checkbox:checked'));
    window.batchMoveFiles = checked.map(cb => window.currentFiles[cb.dataset.index]).filter(f => f && !f.isDirectory);
    if (window.batchMoveFiles.length === 0) return;
    showBatchMoveModal();
}

function showBatchMoveModal() {
    const modal = document.getElementById('moveModal');
    const select = document.getElementById('moveTargetDir');
    fetch('/api/subdirs').then(r => r.json()).then(subdirs => {
        select.innerHTML = '';
        const rootOpt = document.createElement('option');
        rootOpt.value = '';
        rootOpt.textContent = '根目录';
        select.appendChild(rootOpt);
        subdirs.forEach(dir => {
            const opt = document.createElement('option');
            opt.value = dir;
            opt.textContent = dir;
            select.appendChild(opt);
        });
    });
    modal.style.display = 'block';
    const btn = modal.querySelector('.modal-actions button:last-child');
    if (btn) btn.onclick = confirmBatchMove;
}

async function confirmBatchMove() {
    const targetDir = document.getElementById('moveTargetDir').value;
    for (const file of window.batchMoveFiles) {
        const oldPath = file.subdir === '根目录' ? file.name : `${file.subdir}/${file.name}`;
        await fetch('/api/files/move', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldPath, targetDir })
        });
    }
    closeMoveModal();
    showToast('批量移动完成');
    fetchFiles();
}

// ============ 存储配额 ============
async function loadQuota() {
    try {
        const res = await fetch('/api/quota');
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.quota > 0) {
            storageQuota = data.quota;
        }
    } catch (e) {
        // 获取失败时保持默认 10 GB
    }
    const totalEl = document.getElementById('storageTotal');
    if (totalEl) totalEl.textContent = '共 ' + formatBytes(storageQuota);
}

// ============ 存储环 ============
function updateStorageRing(files) {
    const regularFiles = files.filter(f => !f.isDirectory);
    const total = regularFiles.reduce((sum, f) => sum + parseSize(f.size), 0);
    const percent = Math.min((total / storageQuota) * 100, 100);
    const ring = document.querySelector('.storage-ring-progress');
    const percentEl = document.getElementById('storagePercent');
    const usedEl = document.getElementById('storageUsed');
    const totalEl = document.getElementById('storageTotal');
    if (ring) ring.style.strokeDashoffset = 97.4 * (1 - percent / 100);
    if (percentEl) percentEl.textContent = percent < 1 && percent > 0 ? '<1%' : Math.round(percent) + '%';
    if (usedEl) usedEl.textContent = formatBytes(total) + ' 已使用';
    if (totalEl) totalEl.textContent = '共 ' + formatBytes(storageQuota);
}

// ============ 文件选择 ============
function showSelectedFiles(inputId) {
    const fileInput = document.getElementById(inputId);
    const files = fileInput.files;
    const selectedDiv = document.getElementById('selectedFiles');
    if (files.length === 0) {
        selectedDiv.style.display = 'none';
        selectedDiv.innerHTML = '';
        pendingFiles = [];
        return;
    }
    pendingFiles = Array.from(files);
    lastInputId = inputId;
    selectedDiv.style.display = 'block';
    let folderName = null;
    if (files.length > 0 && files[0].webkitRelativePath) {
        const rel = files[0].webkitRelativePath;
        const topFolder = rel.split('/')[0];
        const allInSameFolder = Array.from(files).every(f => f.webkitRelativePath && f.webkitRelativePath.startsWith(topFolder + '/'));
        if (allInSameFolder) folderName = topFolder;
    }
    if (folderName) {
        selectedDiv.innerHTML = `<b>已选文件夹：</b> <span style="font-weight:700;">${escapeHtml(folderName)}/</span>（${files.length} 个文件）`;
    } else {
        const maxShow = 8;
        let html = `<b>已选 ${files.length} 个文件：</b><ul>`;
        for (let i = 0; i < Math.min(files.length, maxShow); i++) {
            html += `<li>${escapeHtml(files[i].name)}</li>`;
        }
        if (files.length > maxShow) html += `<li>...等 ${files.length} 个文件</li>`;
        html += '</ul>';
        selectedDiv.innerHTML = html;
    }
    updateUploadButtonState();
}

function updateUploadButtonState() {
    const btn = document.getElementById('btnUploadStart');
    if (btn) btn.disabled = pendingFiles.length === 0;
}

function triggerUpload() {
    if (pendingFiles.length === 0) {
        showToast('请先选择文件或文件夹', 2000, 'error');
        return;
    }
    uploadFiles(pendingFiles);
}

// ============ 上传（逐文件进度条） ============
async function uploadFiles(files) {
    const subdirSelect = document.getElementById('subdirSelect');
    const subdir = subdirSelect.value;
    const progressList = document.getElementById('uploadProgressList');
    const statusDiv = document.getElementById('uploadStatus');
    const panel = document.getElementById('uploadPanel');
    panel.classList.remove('collapsed');

    // 文件夹上传：先创建顶层文件夹
    if (lastInputId === 'folderInput') {
        const topFolders = new Set();
        for (const file of files) {
            if (file.webkitRelativePath) {
                topFolders.add(file.webkitRelativePath.split('/')[0]);
            }
        }
        for (const folder of topFolders) {
            await fetch('/api/create-folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subdir, folderPath: folder })
            });
        }
    }

    // 渲染每个文件的进度条
    progressList.innerHTML = '';
    const itemEls = files.map((file, i) => {
        const item = document.createElement('div');
        item.className = 'upload-item';
        item.innerHTML = `
            <div class="upload-item-header">
                <span class="upload-item-name">${escapeHtml(file.name)}</span>
                <span class="upload-item-percent" id="upPercent${i}">0%</span>
            </div>
            <div class="upload-progress-track">
                <div class="upload-progress-fill" id="upFill${i}"></div>
            </div>
        `;
        progressList.appendChild(item);
        return item;
    });

    let aborted = false;
    const cancelBtn = document.getElementById('btnUploadCancel');
    cancelBtn.onclick = () => { aborted = true; };

    let successCount = 0;
    for (let i = 0; i < files.length; i++) {
        if (aborted) {
            for (let j = i; j < files.length; j++) {
                itemEls[j].classList.add('cancelled');
                document.getElementById('upPercent' + j).textContent = '已取消';
            }
            break;
        }
        const file = files[i];
        const formData = new FormData();
        formData.append('file', file, file.name);
        const url = '/api/upload?subdir=' + encodeURIComponent(subdir) +
            '&filename=' + encodeURIComponent(utf8ToBase64(file.name)) +
            (file.webkitRelativePath ? '&relativePath=' + encodeURIComponent(file.webkitRelativePath) : '');
        await new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            xhr.upload.addEventListener('progress', (event) => {
                if (event.lengthComputable) {
                    const percent = Math.round((event.loaded / event.total) * 100);
                    document.getElementById('upFill' + i).style.width = percent + '%';
                    document.getElementById('upPercent' + i).textContent = percent + '%';
                }
            });
            xhr.onload = () => resolve();
            xhr.onerror = () => resolve();
            xhr.onabort = () => resolve();
            cancelBtn.onclick = () => { aborted = true; xhr.abort(); };
            xhr.open('POST', url);
            xhr.send(formData);
        });
        if (aborted) {
            itemEls[i].classList.add('cancelled');
            document.getElementById('upPercent' + i).textContent = '已取消';
        } else {
            itemEls[i].classList.add('done');
            document.getElementById('upFill' + i).style.width = '100%';
            document.getElementById('upPercent' + i).textContent = '✓';
            successCount++;
        }
    }

    if (aborted) {
        statusDiv.textContent = '已取消上传';
        statusDiv.style.color = '#ef4444';
        showToast('已取消上传', 2000, 'error');
    } else {
        statusDiv.textContent = `✅ 成功上传 ${successCount}/${files.length} 个文件`;
        statusDiv.style.color = '#10b981';
        showToast(`成功上传 ${successCount} 个文件`);
        setTimeout(() => {
            progressList.innerHTML = '';
            statusDiv.textContent = '';
            statusDiv.style.color = '';
            document.getElementById('selectedFiles').style.display = 'none';
            document.getElementById('selectedFiles').innerHTML = '';
            pendingFiles = [];
            updateUploadButtonState();
            panel.classList.add('collapsed');
        }, 2000);
        document.getElementById('fileInput').value = '';
        document.getElementById('folderInput').value = '';
        fetchFiles();
    }
}

// ============ 上传面板折叠 ============
function toggleUploadPanel() {
    document.getElementById('uploadPanel').classList.toggle('collapsed');
}

// ============ 拖拽上传 ============
function setupDragDrop() {
    const overlay = document.getElementById('dropOverlay');
    let dragCounter = 0;
    document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        overlay.classList.add('active');
    });
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            overlay.classList.remove('active');
        }
    });
    document.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        overlay.classList.remove('active');
        const files = Array.from(e.dataTransfer.files);
        if (files.length === 0) return;
        pendingFiles = files;
        lastInputId = 'fileInput';
        const selectedDiv = document.getElementById('selectedFiles');
        selectedDiv.style.display = 'block';
        let html = `<b>已拖入 ${files.length} 个文件：</b><ul>`;
        files.slice(0, 8).forEach(f => { html += `<li>${escapeHtml(f.name)}</li>`; });
        if (files.length > 8) html += `<li>...等 ${files.length} 个文件</li>`;
        html += '</ul>';
        selectedDiv.innerHTML = html;
        document.getElementById('uploadPanel').classList.remove('collapsed');
        updateUploadButtonState();
    });
}

// ============ 初始化 ============
document.addEventListener('DOMContentLoaded', function() {
    // 侧边栏
    setupSidebar();
    // 侧边栏导航点击
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo(item.dataset.dir);
        });
    });
    // 文件选择
    document.getElementById('fileInput').addEventListener('change', function() {
        showSelectedFiles('fileInput');
    });
    document.getElementById('folderInput').addEventListener('change', function() {
        showSelectedFiles('folderInput');
    });
    // 重命名回车
    document.getElementById('newFileName').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') confirmRename();
    });
    // 模态框关闭
    const renameModal = document.getElementById('renameModal');
    document.querySelector('.close').onclick = closeRenameModal;
    const moveModal = document.getElementById('moveModal');
    document.querySelector('.close-move').onclick = closeMoveModal;
    document.querySelector('.close-confirm').onclick = () => closeConfirmModal(false);
    window.onclick = function(event) {
        if (event.target === renameModal) closeRenameModal();
        if (event.target === moveModal) closeMoveModal();
        if (event.target === document.getElementById('confirmModal')) closeConfirmModal(false);
    };
    // 拖拽上传
    setupDragDrop();
    // 初始视图
    applyView();
    renderBreadcrumb();
    // 加载存储配额
    loadQuota();
    // 初始加载
    fetchFiles();
});

// ============ 返回上级 ============
function goBackDir() {
    if (!currentDir) return;
    const arr = currentDir.split('/');
    arr.pop();
    navigateTo(arr.join('/'));
}
