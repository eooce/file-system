let currentXhr = null; 
let currentFileForRename = null; 
let currentFileForMove = null; 
let lastInputId = null;

// 获取文件列表
async function fetchFiles() {
    try {
        const filterSubdir = document.getElementById('filterSubdir').value;
        document.getElementById('backBtn').style.display = filterSubdir ? '' : 'none';
        const url = filterSubdir ? `/api/files?subdir=${filterSubdir}` : '/api/files';
        const response = await fetch(url);
        const files = await response.json();
        const tableBody = document.querySelector('#fileTable tbody');
        tableBody.innerHTML = '';
        
        if (files.length === 0) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 5;
            cell.textContent = 'No files found';
            cell.style.textAlign = 'center';
            row.appendChild(cell);
            tableBody.appendChild(row);
            return;
        }
        
        const folderOrder = ['videos', 'audios', 'pictures', 'documents', 'others'];
        files.sort((a, b) => {
            if (a.isDirectory && b.isDirectory) {
                return folderOrder.indexOf(a.name) - folderOrder.indexOf(b.name);
            } else if (a.isDirectory) {
                return -1;
            } else if (b.isDirectory) {
                return 1;
            } else {
                return 0;
            }
        });
        
        window.currentFiles = files;
        
        files.forEach((file, idx) => {
            const row = document.createElement('tr');
            
            // 复选框列
            const checkboxCell = document.createElement('td');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'row-checkbox';
            checkbox.dataset.index = idx;
            checkbox.onclick = updateBatchToolbar;
            checkboxCell.appendChild(checkbox);
            row.appendChild(checkboxCell);
            
            // 文件名列
            const nameCell = document.createElement('td');
            let icon = '';
            if (file.isDirectory) {
                icon = '📁 ';
                const folderLink = document.createElement('a');
                folderLink.className = 'folder-link';
                folderLink.textContent = icon + file.name + '/';
                folderLink.href = '#';
                folderLink.onclick = function(e) {
                    e.preventDefault();
                    const filterSubdir = document.getElementById('filterSubdir');
                    const newValue = filterSubdir.value ? filterSubdir.value + '/' + file.name : file.name;
                    // 如果 select 没有这个 option，则动态添加
                    let found = false;
                    for (let i = 0; i < filterSubdir.options.length; i++) {
                        if (filterSubdir.options[i].value === newValue) {
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        const opt = document.createElement('option');
                        opt.value = newValue;
                        opt.textContent = newValue;
                        filterSubdir.appendChild(opt);
                    }
                    filterSubdir.value = newValue;
                    fetchFiles();
                };
                nameCell.appendChild(folderLink);
            } else {
                // 判断文件类型
                const ext = file.name.split('.').pop().toLowerCase();
                if (["mp4","webm","ogg","mov","m4v","avi"].includes(ext)) icon = '🎬 ';
                else if (["mp3","wav","aac","flac","m4a"].includes(ext)) icon = '🎵 ';
                else if (["jpg","jpeg","png","gif","bmp","webp","svg"].includes(ext)) icon = '🖼️ ';
                else if (["doc","docx","pdf","xls","xlsx","ppt","pptx","txt","md","csv"].includes(ext)) icon = '📄 ';
                else if (["zip","rar","7z","tar","gz"].includes(ext)) icon = '🗜️ ';
                else if (["json","yaml","toml"].includes(ext)) icon = '🧾 '
                else icon = '📦 ';
                const link = document.createElement('a');
                link.href = file.downloadUrl;
                link.textContent = icon + file.name;
                link.className = 'file-link';
                link.target = '_blank';
                link.onclick = function(e) {
                    const ext = file.name.split('.').pop().toLowerCase();
                    const imageExts = ['jpg','jpeg','png','gif','bmp','webp','svg'];
                    const videoExts = ['mp4','webm','ogg','mov','m4v','avi'];
                    const audioExts = ['mp3','wav','ogg','aac','flac','m4a'];
                    if (imageExts.includes(ext) || videoExts.includes(ext) || audioExts.includes(ext)) {
                        e.preventDefault();
                        window.open(file.downloadUrl, '_blank');
                    }
                };
                nameCell.appendChild(link);
            }
            
            // 目录列
            const dirCell = document.createElement('td');
            dirCell.textContent = file.subdir;
            
            // 类型列
            const typeCell = document.createElement('td');
            typeCell.textContent = file.isDirectory ? 'Folder' : 'File';
            
            // 大小列
            const sizeCell = document.createElement('td');
            sizeCell.textContent = file.size;
            
            // 日期列
            const dateCell = document.createElement('td');
            dateCell.textContent = new Date(file.lastModified).toLocaleString();
            
            // 操作列
            const actionCell = document.createElement('td');
            const actionBtn = document.createElement('button');
            actionBtn.textContent = '⋯';
            actionBtn.className = 'action-btn';
            actionBtn.onclick = (e) => showActionMenu(e, file);
            actionCell.appendChild(actionBtn);
            
            row.appendChild(nameCell);
            row.appendChild(dirCell);
            row.appendChild(typeCell);
            row.appendChild(sizeCell);
            row.appendChild(dateCell);
            row.appendChild(actionCell);
            tableBody.appendChild(row);
        });

        // 全选/反选逻辑
        const selectAll = document.getElementById('selectAll');
        selectAll.onclick = function() {
            const checkboxes = document.querySelectorAll('.row-checkbox');
            checkboxes.forEach(cb => { cb.checked = selectAll.checked; });
            updateBatchToolbar();
        };
        function updateBatchToolbar() {
            const checkboxes = document.querySelectorAll('.row-checkbox');
            const checked = Array.from(checkboxes).filter(cb => cb.checked);
            document.getElementById('batchDeleteBtn').disabled = checked.length === 0;
            document.getElementById('batchMoveBtn').disabled = checked.length === 0;
            // 同步全选框状态
            selectAll.checked = checked.length === checkboxes.length && checkboxes.length > 0;
        }

        // 渲染完表格后，主动调用一次，确保按钮状态正确
        updateBatchToolbar();
    } catch (error) {
        console.error('Error fetching files:', error);
        alert('Error loading file list');
    }
}

// 显示操作菜单
function showActionMenu(event, file) {
    // 移除现有的菜单
    const existingMenu = document.querySelector('.action-menu');
    if (existingMenu) {
        existingMenu.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'action-menu';
    document.body.appendChild(menu); // 先加入body以便获取宽度

    // 先填充内容
    const downloadBtn = document.createElement('div');
    downloadBtn.textContent = 'Download';
    downloadBtn.className = 'menu-item';
    downloadBtn.onclick = () => {
        window.open(file.downloadUrl, '_blank');
        menu.remove();
    };
    const renameBtn = document.createElement('div');
    renameBtn.textContent = 'Rename';
    renameBtn.className = 'menu-item';
    renameBtn.onclick = () => {
        showRenameModal(file);
        menu.remove();
    };
    const deleteBtn = document.createElement('div');
    deleteBtn.textContent = 'Delete';
    deleteBtn.className = 'menu-item delete';
    deleteBtn.onclick = () => {
        deleteFile(file);
        menu.remove();
    };
    const moveBtn = document.createElement('div');
    moveBtn.textContent = 'Move';
    moveBtn.className = 'menu-item';
    moveBtn.onclick = () => {
        showMoveModal(file);
        menu.remove();
    };
    menu.appendChild(downloadBtn);
    menu.appendChild(renameBtn);
    menu.appendChild(deleteBtn);
    menu.appendChild(moveBtn);

    // 定位到按钮正下方左对齐
    const rect = event.target.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = rect.bottom + 'px';
    menu.style.left = rect.left + 'px';
    menu.style.zIndex = '1000';

    // 防止菜单超出底部和右侧
    setTimeout(() => {
        const menuRect = menu.getBoundingClientRect();
        let newTop = parseInt(menu.style.top);
        let newLeft = parseInt(menu.style.left);
        if (menuRect.bottom > window.innerHeight) {
            newTop = window.innerHeight - menuRect.height - 10;
            menu.style.top = newTop + 'px';
        }
        if (menuRect.right > window.innerWidth) {
            newLeft = window.innerWidth - menuRect.width - 10;
            menu.style.left = newLeft + 'px';
        }
    }, 0);

    // 点击其他地方关闭菜单
    setTimeout(() => {
        document.addEventListener('click', function closeMenu(e) {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        });
    }, 0);
}

// 显示重命名模态框
function showRenameModal(file) {
    currentFileForRename = file;
    const modal = document.getElementById('renameModal');
    const input = document.getElementById('newFileName');
    input.value = file.name;
    modal.style.display = 'block';
    input.focus();
}

// 确认重命名
async function confirmRename() {
    if (!currentFileForRename) return;
    
    const newName = document.getElementById('newFileName').value.trim();
    if (!newName) {
        alert('Please enter a filename');
        return;
    }

    try {
        const oldPath = currentFileForRename.subdir === '根目录' ? 
            currentFileForRename.name : 
            `${currentFileForRename.subdir}/${currentFileForRename.name}`;
        
        const response = await fetch('/api/files/rename', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                oldPath: oldPath,
                newName: newName
            })
        });

        const result = await response.json();
        if (response.ok) {
            alert('File renamed successfully');
            document.getElementById('renameModal').style.display = 'none';
            fetchFiles();
        } else {
            alert('Error: ' + (result.error || 'Rename failed'));
        }
    } catch (error) {
        console.error('Rename error:', error);
        alert('Rename failed');
    }
}

// 监听两个input的change事件，显示已选文件名
function showSelectedFiles(inputId) {
    const fileInput = document.getElementById(inputId);
    const files = fileInput.files;
    const selectedDiv = document.getElementById('selectedFiles');
    if (files.length === 0) {
        selectedDiv.style.display = 'none';
        selectedDiv.innerHTML = '';
        return;
    }
    selectedDiv.style.display = 'block';
    selectedDiv.style.minHeight = '5rem';
    selectedDiv.style.maxHeight = '10rem';
    // 判断是否为文件夹上传
    let folderName = null;
    if (files.length > 0 && files[0].webkitRelativePath) {
        const rel = files[0].webkitRelativePath;
        const topFolder = rel.split('/')[0];
        const allInSameFolder = Array.from(files).every(f => f.webkitRelativePath && f.webkitRelativePath.startsWith(topFolder + '/'));
        if (allInSameFolder) {
            folderName = topFolder;
        }
    }
    if (folderName) {
        selectedDiv.innerHTML = `<b>已选文件夹：</b> <span style="color:#1976d2;font-weight:bold;">${folderName}/</span>`;
    } else {
        const maxShow = 8;
        let html = '<b>已选文件：</b><ul style="margin:4px 0 0 0;padding-left:18px;">';
        for (let i = 0; i < Math.min(files.length, maxShow); i++) {
            html += `<li>${files[i].name}</li>`;
        }
        if (files.length > maxShow) {
            html += `<li>...等${files.length}个文件</li>`;
        }
        html += '</ul>';
        selectedDiv.innerHTML = html;
    }
}
document.getElementById('fileInput').addEventListener('change', function() {
    lastInputId = 'fileInput';
    showSelectedFiles('fileInput');
});
document.getElementById('folderInput').addEventListener('change', function() {
    lastInputId = 'folderInput';
    showSelectedFiles('folderInput');
});
function triggerUpload() {
    if (!lastInputId) {
        alert('请先选择文件或文件夹');
        return;
    }
    uploadFile(lastInputId);
}

// 上传文件，带进度条和取消
async function uploadFile(inputId) {
    const fileInput = document.getElementById(inputId);
    const subdirSelect = document.getElementById('subdirSelect');
    const files = fileInput.files;
    if (files.length === 0) {
        alert('Please select file(s)');
        return;
    }
    const subdir = subdirSelect.value;
    // 新增：如果是文件夹上传，先创建顶层文件夹
    if (inputId === 'folderInput') {
        const topFolders = new Set();
        for (const file of files) {
            if (file.webkitRelativePath) {
                const top = file.webkitRelativePath.split('/')[0];
                topFolders.add(top);
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
    // 进度条
    const progressContainer = document.createElement('div');
    progressContainer.className = 'progress-container';
    progressContainer.innerHTML = '<div class="progress-bar" id="progressBar">0%</div>';
    // 取消按钮
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.className = 'cancel-btn';
    cancelBtn.style.right = '-75px';
    let aborted = false;
    cancelBtn.onclick = function() {
        aborted = true;
        progressContainer.remove();
        document.getElementById('uploadStatus').textContent = '已取消上传';
        document.getElementById('selectedFiles').innerHTML = '';
    };
    progressContainer.appendChild(cancelBtn);
    document.querySelector('.card-upload').appendChild(progressContainer);
    const progressBar = document.getElementById('progressBar');
    const statusDiv = document.getElementById('uploadStatus');
    let uploaded = 0;
    for (let i = 0; i < files.length; i++) {
        if (aborted) break;
        await new Promise((resolve) => {
            const file = files[i];
            const formData = new FormData();
            formData.append('file', file, file.name);
            const url = '/api/upload?subdir=' + encodeURIComponent(subdir) +
                '&filename=' + encodeURIComponent(utf8ToBase64(file.name)) +
                (file.webkitRelativePath ? '&relativePath=' + encodeURIComponent(file.webkitRelativePath) : '');
            const xhr = new XMLHttpRequest();
            xhr.upload.addEventListener('progress', (event) => {
                if (event.lengthComputable) {
                    const percent = Math.round((event.loaded / event.total) * 100);
                    progressBar.style.width = percent + '%';
                    progressBar.textContent = `(${i+1}/${files.length}) ` + percent + '%';
                }
            });
            xhr.onload = function() { resolve(); };
            xhr.onerror = function() { resolve(); };
            xhr.onabort = function() { resolve(); };
            cancelBtn.onclick = function() {
                aborted = true;
                xhr.abort();
                progressContainer.remove();
                document.getElementById('uploadStatus').textContent = '已取消上传';
                document.getElementById('selectedFiles').innerHTML = '';
            };
            xhr.open('POST', url);
            xhr.send(formData);
        });
        uploaded++;
        progressBar.style.width = '100%';
        progressBar.textContent = `(${uploaded}/${files.length}) 100%`;
    }
    if (!aborted) {
        statusDiv.textContent = 'Upload completed successfully!';
        statusDiv.style.color = '#43a047';
        setTimeout(() => {
            progressContainer.remove();
            statusDiv.textContent = '';
            document.getElementById('selectedFiles').innerHTML = '';
            // 新增：彻底重置上传区高度和 padding，并移除所有进度条等非表单内容
            const cardUpload = document.querySelector('.card-upload');
            if (cardUpload) {
                cardUpload.style.minHeight = '120px';
                cardUpload.style.paddingTop = '30px';
                cardUpload.style.paddingBottom = '0';
                // 移除所有进度条等非表单内容
                const children = Array.from(cardUpload.children);
                children.forEach(child => {
                    if (child.classList && child.classList.contains('progress-container')) child.remove();
                });
            }
        }, 1500);
        fileInput.value = '';
        fetchFiles();
    }
}

// 删除文件
async function deleteFile(file, silent = false) {
    if (!silent) {
        if (!confirm('Are you sure you want to delete "' + file.name + '"?')) {
            return;
        }
    }
    try {
        const filePath = file.subdir === '根目录' ? 
            file.name : 
            `${file.subdir}/${file.name}`;
        const response = await fetch('/api/files/' + encodeURIComponent(filePath), {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        const result = await response.json();
        if (response.ok) {
            showToast('File deleted successfully', 2000);
            fetchFiles();
        } else {
            showToast('Error: ' + (result.error || 'Delete failed'), 3000);
        }
    } catch (error) {
        console.error('Delete error:', error);
        showToast('Delete failed', 3000);
    }
}

// 模态框关闭事件
document.addEventListener('DOMContentLoaded', function() {
    const modal = document.getElementById('renameModal');
    const span = document.getElementsByClassName('close')[0];
    
    span.onclick = function() {
        modal.style.display = 'none';
    }
    
    window.onclick = function(event) {
        if (event.target == modal) {
            modal.style.display = 'none';
        }
    }
    
    // 回车键确认重命名
    document.getElementById('newFileName').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            confirmRename();
        }
    });
});

// 初始加载文件列表
fetchFiles();

function utf8ToBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
}

// 返回上一级目录
function goBackDir() {
    const filterSubdir = document.getElementById('filterSubdir');
    if (!filterSubdir.value) return;
    const arr = filterSubdir.value.split('/');
    arr.pop();
    filterSubdir.value = arr.join('/');
    fetchFiles();
}

// 全局中间提示
function showToast(msg, duration=2000) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.style.display = 'block';
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
        toast.style.display = 'none';
    }, duration);
}

// 新增 Move 模态框
function showMoveModal(file) {
    currentFileForMove = file;
    const modal = document.getElementById('moveModal');
    const select = document.getElementById('moveTargetDir');
    // 获取所有可选文件夹（不含当前目录）
    fetch('/api/subdirs').then(r=>r.json()).then(subdirs=>{
        select.innerHTML = '';
        // 添加根目录选项
        const rootOpt = document.createElement('option');
        rootOpt.value = '';
        rootOpt.textContent = '根目录';
        if (!file.subdir || file.subdir === '根目录') {
            rootOpt.disabled = true;
        }
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
}

function confirmMove() {
    if (!currentFileForMove) return;
    const targetDir = document.getElementById('moveTargetDir').value;
    const oldPath = currentFileForMove.subdir === '根目录' ? currentFileForMove.name : `${currentFileForMove.subdir}/${currentFileForMove.name}`;
    fetch('/api/files/move', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath, targetDir })
    }).then(r=>r.json()).then(result=>{
        if (result && result.message) {
            showToast('File moved successfully', 2000);
            document.getElementById('moveModal').style.display = 'none';
            fetchFiles();
        } else {
            showToast('Move failed: ' + (result.error || ''), 3000);
        }
    }).catch(()=>{
        showToast('Move failed', 3000);
    });
}

// 关闭模态框事件
window.addEventListener('DOMContentLoaded', function() {
    const moveModal = document.getElementById('moveModal');
    const closeMove = document.querySelector('.close-move');
    if (closeMove) {
        closeMove.onclick = function() { moveModal.style.display = 'none'; };
    }
    window.onclick = function(event) {
        if (event.target == moveModal) moveModal.style.display = 'none';
    };
});

// 批量删除
async function batchDelete() {
    const checkboxes = document.querySelectorAll('.row-checkbox');
    const checked = Array.from(checkboxes).filter(cb => cb.checked);
    if (checked.length === 0) return;
    if (!confirm('确定要删除选中的 ' + checked.length + ' 个文件/文件夹吗？')) return;
    for (const cb of checked) {
        const idx = cb.dataset.index;
        const file = window.currentFiles[idx];
        if (!file.isDirectory) {
            await deleteFile(file, true); // silent模式，不再弹窗
        }
    }
    fetchFiles();
}

// 批量移动
function batchMove() {
    const checkboxes = document.querySelectorAll('.row-checkbox');
    const checked = Array.from(checkboxes).filter(cb => cb.checked);
    window.batchMoveFiles = checked.map(cb => window.currentFiles[cb.dataset.index]).filter(f => !f.isDirectory);
    if (window.batchMoveFiles.length === 0) return;
    showBatchMoveModal();
}

function showBatchMoveModal() {
    const modal = document.getElementById('moveModal');
    const select = document.getElementById('moveTargetDir');
    // 获取所有可选文件夹
    fetch('/api/subdirs').then(r=>r.json()).then(subdirs=>{
        select.innerHTML = '';
        // 添加根目录选项
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
    // 修改确认按钮事件
    const btn = modal.querySelector('button');
    btn.onclick = confirmBatchMove;
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
    document.getElementById('moveModal').style.display = 'none';
    fetchFiles();
}
