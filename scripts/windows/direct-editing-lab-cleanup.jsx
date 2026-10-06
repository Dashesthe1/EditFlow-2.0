// Acceptance lab only. Never remove a user composition or imported item.
(function () {
  if (!app.project) throw new Error('No test project is open');
  for (var i = 1; i <= app.project.numItems; i++) {
    if (String(app.project.item(i).comment).indexOf('ef-live-lab-') < 0) {
      throw new Error('Refusing to close a project containing a non-lab item');
    }
  }
  app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
  app.newProject();
}());
