// Foto del cantiere: ridimensionate e compresse sul telefono prima di salvarle.
export const MAX_FOTO = 8;

export function comprimiImmagine(file, { lato = 1400, qualita = 0.72, formato = "image/jpeg" } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type || "")) {
      reject(new Error("Il file non è un'immagine"));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scala = Math.min(1, lato / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * scala));
      c.height = Math.max(1, Math.round(img.naturalHeight * scala));
      const ctx = c.getContext("2d");
      // Sfondo bianco: le PNG trasparenti non diventano nere in JPEG.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve({ img: c.toDataURL(formato, qualita), larghezza: c.width, altezza: c.height });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Immagine non leggibile"));
    };
    img.src = url;
  });
}
