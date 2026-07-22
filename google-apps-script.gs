// ============================================================
// Google Apps Script — saves uploaded files to YOUR Google Drive.
// Files go into a folder called "Issue Reports" (created automatically).
//
// SETUP (one time):
// 1. Go to https://script.google.com  ->  New project.
// 2. Delete the sample code, paste ALL of this, and save.
// 3. Click Deploy -> New deployment -> gear icon -> Web app.
//    - Description: anything
//    - Execute as:  Me  (files land in your Drive)
//    - Who has access:  Anyone
// 4. Deploy -> Authorize access -> pick your Google account -> Allow.
// 5. Copy the Web app URL that ends in /exec.
// 6. In Vercel, add env var  DRIVE_UPLOAD_URL = <that /exec URL>  and redeploy.
// ============================================================

var FOLDER_NAME = "Issue Reports";

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var folder = getFolder(FOLDER_NAME);
    var bytes = Utilities.base64Decode(body.dataBase64);
    var blob = Utilities.newBlob(bytes, body.mimeType || "application/octet-stream", body.filename || "upload");
    var file = folder.createFile(blob);
    // Make the link viewable so it opens from Telegram / GitHub.
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return json({ ok: true, url: file.getUrl(), id: file.getId() });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function getFolder(name) {
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
