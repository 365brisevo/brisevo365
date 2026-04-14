const formNote = document.querySelector("#form-note");

if (formNote) {
  const params = new URLSearchParams(window.location.search);

  if (params.get("sent") === "1") {
    formNote.textContent = "Poruka je poslana uredništvu. Hvala na dojavi.";
  }
}
