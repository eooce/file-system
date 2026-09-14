require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const basicAuth = require('express-basic-auth');
const iconv = require('iconv-lite');
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 9999;
const USERNAME = process.env.USERNAME || 'admin';
const PASSWORD = process.env.PASSWORD || 'admin';

// 存储配额，默认 10G
function parseQuotaSize(raw) {
    const DEFAULT_QUOTA = 10 * 1024 * 1024 * 1024; // 10 GB
    if (!raw) return DEFAULT_QUOTA;
    const m = String(raw).trim().match(/^([\d.]+)\s*([kmgt]i?b?)?$/i);
    if (!m || isNaN(parseFloat(m[1]))) {
        console.warn(`QUOTA_SIZE 格式无效: "${raw}"，使用默认 10G`);
        return DEFAULT_QUOTA;
    }
    const value = parseFloat(m[1]);
    const unit = (m[2] || '').toLowerCase().replace('i', '').replace('b', '');
    const mult = { '': 1, 'k': 1024, 'm': 1024 ** 2, 'g': 1024 ** 3, 't': 1024 ** 4 };
    return Math.round(value * (mult[unit] !== undefined ? mult[unit] : 1));
}
const QUOTA_SIZE = parseQuotaSize(process.env.QUOTA_SIZE);

const FILES_DIR = path.join(__dirname, 'files');

// 确保 files 目录和子目录存在
function ensureDirectories() {
    const subdirs = ['videos', 'audios', 'pictures', 'documents', 'others'];
    
    if (!fs.existsSync(FILES_DIR)) {
        fs.mkdirSync(FILES_DIR);
        console.log(`Created directory: ${FILES_DIR}`);
    }
    
    subdirs.forEach(subdir => {
        const subdirPath = path.join(FILES_DIR, subdir);
        if (!fs.existsSync(subdirPath)) {
            fs.mkdirSync(subdirPath);
            console.log(`Created subdirectory: ${subdirPath}`);
        }
    });
}

ensureDirectories();

// 安全验证多级路径
function sanitizePath(relPath) {
    if (!relPath || relPath.trim() === '') throw new Error('Invalid path: empty');
    const resolved = path.resolve(FILES_DIR, relPath);
    const base = path.resolve(FILES_DIR) + path.sep;
    if (!(resolved + path.sep).startsWith(base) && resolved !== path.resolve(FILES_DIR)) {
        throw new Error('Invalid path: path traversal detected');
    }
    return path.relative(FILES_DIR, resolved);
}

// Basic Auth 配置
const authMiddleware = basicAuth({
    users: { [USERNAME]: PASSWORD },
    challenge: true,
    unauthorizedResponse: 'Unauthorized Access'
});

// 文件存储配置
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        try {
            const subdir = req.query.subdir;
            let uploadDir = subdir ? path.join(FILES_DIR, sanitizePath(subdir)) : FILES_DIR;
            const relativePath = req.query.relativePath;
            if (relativePath) {
                // 去掉文件名部分，只保留目录
                const relDir = path.dirname(relativePath);
                uploadDir = relDir === '.' ? uploadDir : path.join(uploadDir, sanitizePath(relDir));
            }
            fs.mkdirSync(uploadDir, { recursive: true });
            cb(null, uploadDir);
        } catch (e) {
            cb(e);
        }
    },
    filename: (req, file, cb) => {
        let filename = file.originalname;
        const queryFilename = req.query.filename;
        console.log('query.filename:', queryFilename, '原始名:', file.originalname);
        if (queryFilename) {
            try {
                filename = Buffer.from(queryFilename, 'base64').toString('utf8');
            } catch (e) {
                console.warn('文件名base64解码失败:', e.message);
            }
        } else {
            try {
                const buffer = Buffer.from(filename, 'latin1');
                filename = iconv.decode(buffer, 'gbk');
            } catch (e) {
                console.warn('文件名转码失败:', e.message);
            }
        }
        cb(null, filename);
    }
});
const upload = multer({ storage });

// CORS 中间件
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// 获取文件列表
app.get('/api/files', (req, res) => {
    const subdir = req.query.subdir || '';
    let targetDir;
    try {
        targetDir = subdir ? path.join(FILES_DIR, sanitizePath(subdir)) : FILES_DIR;
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }
    fs.readdir(targetDir, { withFileTypes: true }, (err, files) => {
        if (err) {
            return res.status(500).json({ error: 'Unable to read directory' });
        }
        const fileList = files.map(file => {
            let name = file.name;
            const filePath = path.join(targetDir, name);
            const stats = fs.statSync(filePath);
            const isDirectory = file.isDirectory();
            const relativePath = subdir ? `${subdir}/${name}` : name;
            return {
                name,
                subdir: subdir || '根目录',
                isDirectory,
                size: isDirectory ? '' : (stats.size / (1024 * 1024)).toFixed(2) + ' MB',
                lastModified: stats.mtime,
                downloadUrl: !isDirectory ? `${req.protocol}://${req.get('host')}/download/${encodeURIComponent(relativePath)}` : null
            };
        });
        res.setHeader('Content-Type', 'application/json');
        res.send(JSON.stringify(fileList, null, 2));
    });
});

// 获取子目录列表
app.get('/api/subdirs', authMiddleware, (req, res) => {
    const subdirs = ['videos', 'audios', 'pictures', 'documents', 'others'];
    res.json(subdirs);
});

// 获取存储配额（字节）
app.get('/api/quota', authMiddleware, (req, res) => {
    res.json({ quota: QUOTA_SIZE });
});

// 文件直链下载
app.get('/download/*', (req, res) => {
    try {
        const relativePath = sanitizePath(req.params[0]);
        const filePath = path.join(FILES_DIR, relativePath);
        if (fs.existsSync(filePath)) {
            const ext = path.extname(filePath).toLowerCase().slice(1);
            const previewExts = [
                'jpg','jpeg','png','gif','bmp','webp','svg',
                'mp4','webm','ogg','mov','m4v','avi',
                'mp3','wav','aac','flac','m4a',
                'pdf'
            ];
            const mimeTypes = {
                jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml',
                mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg', mov: 'video/quicktime', m4v: 'video/x-m4v', avi: 'video/x-msvideo',
                mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac', flac: 'audio/flac', m4a: 'audio/mp4',
                pdf: 'application/pdf'
            };
            if (previewExts.includes(ext)) {
                if (mimeTypes[ext]) {
                    res.setHeader('Content-Type', mimeTypes[ext]);
                }
                res.sendFile(filePath);
            } else {
                res.download(filePath, path.basename(filePath), (err) => {
                    if (err) {
                        console.error('Download error:', err);
                        if (!res.headersSent) {
                            res.status(500).send('Download failed');
                        }
                    }
                });
            }
        } else {
            res.status(404).send('File not found');
        }
    } catch (error) {
        console.error('Download error:', error);
        res.status(400).send(error.message);
    }
});

// 文件上传
app.post('/api/upload', authMiddleware, upload.single('file'), (req, res) => {
    const subdir = req.query.subdir;
    const filename = req.file.filename;
    const relativePath = subdir ? `${subdir}/${filename}` : filename;
    res.json({
        message: '上传成功',
        file: filename,
        subdir: subdir || '根目录',
        downloadUrl: `${req.protocol}://${req.get('host')}/download/${encodeURIComponent(relativePath)}`
    });
});

// 文件删除
app.delete('/api/files/*', authMiddleware, (req, res) => {
    try {
        const relativePath = sanitizePath(req.params[0]);
        const filePath = path.join(FILES_DIR, relativePath);
        if (fs.existsSync(filePath)) {
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                // 递归删除目录
                fs.rmSync(filePath, { recursive: true, force: true });
                res.json({ message: 'Directory deleted successfully' });
            } else {
                fs.unlink(filePath, (err) => {
                    if (err) {
                        console.error('Delete error:', err);
                        return res.status(500).json({ error: 'Failed to delete file' });
                    }
                    res.json({ message: 'File deleted successfully' });
                });
            }
        } else {
            res.status(404).json({ error: 'File not found' });
        }
    } catch (error) {
        console.error('Delete error:', error);
        res.status(400).json({ error: error.message });
    }
});

// 文件重命名
app.put('/api/files/rename', authMiddleware, (req, res) => {
    try {
        const { oldPath, newName } = req.body;
        if (!oldPath || !newName) {
            return res.status(400).json({ error: 'Missing oldPath or newName' });
        }
        const oldFilePath = path.join(FILES_DIR, sanitizePath(oldPath));
        const newFilePath = path.join(FILES_DIR, path.dirname(sanitizePath(oldPath)), newName);
        if (!fs.existsSync(oldFilePath)) {
            return res.status(404).json({ error: 'File not found' });
        }
        fs.renameSync(oldFilePath, newFilePath);
        res.json({ 
            message: 'File renamed successfully',
            newPath: path.join(path.dirname(oldPath), newName)
        });
    } catch (error) {
        console.error('Rename error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 文件移动
app.put('/api/files/move', authMiddleware, (req, res) => {
    try {
        let { oldPath, targetDir } = req.body;
        if (!oldPath || targetDir === undefined || targetDir === null) {
            return res.status(400).json({ error: 'Missing oldPath or targetDir' });
        }
        // 允许空字符串、'/'、'根目录' 视为根目录
        if (targetDir === '' || targetDir === '/' || targetDir === '根目录') {
            targetDir = '';
        }
        const oldFilePath = path.join(FILES_DIR, sanitizePath(oldPath));
        const fileName = path.basename(oldFilePath);
        // 根目录时不要sanitizePath("")
        const newFilePath = targetDir
            ? path.join(FILES_DIR, sanitizePath(targetDir), fileName)
            : path.join(FILES_DIR, fileName);
        if (!fs.existsSync(oldFilePath)) {
            return res.status(404).json({ error: 'File not found' });
        }
        const targetDirPath = targetDir
            ? path.join(FILES_DIR, sanitizePath(targetDir))
            : FILES_DIR;
        if (!fs.existsSync(targetDirPath)) {
            return res.status(400).json({ error: 'Target directory does not exist' });
        }
        fs.renameSync(oldFilePath, newFilePath);
        res.json({
            message: 'File moved successfully',
            newPath: targetDir ? path.join(targetDir, fileName) : fileName
        });
    } catch (error) {
        console.error('Move error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 创建文件夹
app.post('/api/create-folder', authMiddleware, (req, res) => {
    try {
        const { subdir, folderPath } = req.body;
        if (!folderPath) return res.status(400).json({ error: 'Missing folderPath' });
        const baseDir = subdir ? path.join(FILES_DIR, sanitizePath(subdir)) : FILES_DIR;
        const targetDir = path.join(baseDir, sanitizePath(folderPath));
        fs.mkdirSync(targetDir, { recursive: true });
        res.json({ message: 'Folder created successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 静态资源
app.use(authMiddleware, express.static(path.join(__dirname, 'public')));

// 首页路由
app.get('/', authMiddleware, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 启动服务器
app.listen(PORT, () => {
    console.log('Environment variables loaded:', {
        PORT: process.env.PORT,
        USERNAME: process.env.USERNAME ? 'set' : 'using default',
        PASSWORD: process.env.PASSWORD ? 'set' : 'using default'
    });
    console.log(`Files directory: ${FILES_DIR}`);
    console.log(`Basic Auth credentials: ${USERNAME}/${PASSWORD}`);
    console.log(`Server is running on http://localhost:${PORT}`);
});
