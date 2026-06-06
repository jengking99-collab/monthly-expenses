const { app, BrowserWindow, dialog, Menu, ipcMain } = require('electron');
const { exec } = require('child_process');
const path = require('path');

const isDev = !app.isPackaged;

// exe 옆의 data/ 폴더에 저장 (포터블 앱에 적합)
if (!isDev) {
  app.setPath('userData', path.join(path.dirname(app.getPath('exe')), 'data'));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: '월 지출관리 V1.0',
    backgroundColor: '#0f1117',
    show: false,
  });

  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // 엑셀 저장 다이얼로그
  win.webContents.session.on('will-download', (event, item) => {
    const filename = item.getFilename();
    const ext = path.extname(filename).toLowerCase();
    const filters =
      ext === '.xlsx'
        ? [{ name: 'Excel 파일', extensions: ['xlsx'] }, { name: '모든 파일', extensions: ['*'] }]
        : [{ name: '모든 파일', extensions: ['*'] }];

    const savePath = dialog.showSaveDialogSync(win, { defaultPath: filename, filters });
    if (savePath) item.setSavePath(savePath);
    else item.cancel();
  });

  // 외부 URL 탐색 차단
  win.webContents.on('will-navigate', (event, url) => {
    if (isDev && url.startsWith('http://localhost:5173')) return;
    if (!isDev && url.startsWith('file://')) return;
    event.preventDefault();
  });
}

ipcMain.on('open-calculator', () => exec('calc.exe'));

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
