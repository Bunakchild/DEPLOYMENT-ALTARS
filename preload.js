const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
    'api', {
        send: (channel, data) => {
            // whitelist channels
            let validChannels = ['toMain'];
            if (validChannels.includes(channel)) {
                ipcRenderer.send(channel, data);
            }
        },
        receive: (channel, func) => {
            let validChannels = ['fromMain'];
            if (validChannels.includes(channel)) {
                // Deliberately strip event as it includes `sender` 
                ipcRenderer.on(channel, (event, ...args) => func(...args));
            }
        }
    }
);

contextBridge.exposeInMainWorld('electronAPI', {
    // Student-related functions
    addStudent: (studentData) => ipcRenderer.invoke('add-student', studentData),
    addStudents: (studentsData) => ipcRenderer.invoke('add-students', studentsData),
    getStudents: () => ipcRenderer.invoke('get-students'),
    
    // Book-related functions
    addBook: (bookData) => ipcRenderer.invoke('add-book', bookData),
    addBooks: (booksData) => ipcRenderer.invoke('add-books', booksData),
    getBooks: () => ipcRenderer.invoke('get-books'),
    updateBook: (bookData) => ipcRenderer.invoke('update-book', bookData),
    
    // Borrowing-related functions
    recordBorrowing: (borrowData) => ipcRenderer.invoke('record-borrowing', borrowData),
    getHistory: () => ipcRenderer.invoke('get-history'),
    getOverdueBooks: () => ipcRenderer.invoke('get-overdue-books')
});
