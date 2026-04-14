const form = document.querySelector(".contact-form");
const formNote = document.querySelector("#form-note");

if (form && formNote) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const name = String(formData.get("name") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const topic = String(formData.get("topic") || "").trim();
    const message = String(formData.get("message") || "").trim();

    const subject = topic || "Nova priča za 365 Briševo";
    const bodyLines = [
      "Nova prijava za 365 Briševo",
      "",
      `Ime: ${name || "Nije upisano"}`,
      `E-mail: ${email || "Nije upisan"}`,
      `Tema: ${topic || "Nije upisana"}`,
      "",
      "Poruka:",
      message || "Nema poruke."
    ];

    const mailtoUrl = `mailto:urednistvo@365brisevo.hr?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join("\n"))}`;

    window.location.href = mailtoUrl;
    formNote.textContent = "Otvorena je e-mail poruka s pripremljenim sadržajem. Ako se ništa nije otvorilo, javite se na urednistvo@365brisevo.hr.";
    form.reset();
  });
}
