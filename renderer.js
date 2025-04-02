const Html5Qrcode = require("html5-qrcode"); // Make sure to install this package first
const borrowBtn = document.getElementById('borrow-btn');
const returnBtn = document.getElementById('return-btn');
const scannedResult = document.getElementById('scanned-result');
const borrowedBooksList = document.getElementById('borrowed-books-list');

let scannedData = null; // Holds the last scanned student/book

// Initialize QR Code Scanner
const qrReader = new Html5Qrcode("qr-reader");

qrReader.start(
  { facingMode: "environment" }, // Use webcam
  {
    fps: 10,
    qrbox: { width: 250, height: 250 },
  },
  (decodedText, decodedResult) => {
    scannedData = decodedText;
    scannedResult.textContent = `Scanned: ${decodedText}`;
  },
  (errorMessage) => {
    console.warn(`QR Code scan error: ${errorMessage}`);
  }
).catch((err) => console.error(`Error starting QR Code scanner: ${err}`));

// Event Handlers for Borrow/Return
borrowBtn.addEventListener('click', () => {
  if (scannedData) {
    const listItem = document.createElement('li');
    listItem.textContent = `Borrowed: ${scannedData}`;
    borrowedBooksList.appendChild(listItem);
    scannedResult.textContent = "Book borrowed successfully!";
  } else {
    scannedResult.textContent = "Please scan a book or student QR first!";
  }
});

returnBtn.addEventListener('click', () => {
  if (scannedData) {
    const listItem = document.createElement('li');
    listItem.textContent = `Returned: ${scannedData}`;
    borrowedBooksList.appendChild(listItem);
    scannedResult.textContent = "Book returned successfully!";
  } else {
    scannedResult.textContent = "Please scan a book or student QR first!";
  }
});
