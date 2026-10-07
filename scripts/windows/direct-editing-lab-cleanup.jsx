// Acceptance lab only. Never remove a user composition or imported item.
(function () {
  if (!app.project) throw new Error('No test project is open');
  for (var i = 1; i <= app.project.numItems; i++) {
    var item = app.project.item(i);
    if (item instanceof FolderItem && item.name === 'Solids' && item.numItems > 0) {
      var allLab = true;
      for (var j = 1; j <= item.numItems; j++) if (String(item.item(j).comment).indexOf('ef-live-lab-') < 0) allLab = false;
      if (allLab) continue;
    }
    if (String(item.comment).indexOf('ef-live-lab-') < 0) {
      throw new Error('Refusing to close a project containing a non-lab item');
    }
  }
  app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
  app.newProject();
}());
