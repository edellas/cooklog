// Legge il testo di una schermata (OCR di macOS, framework Vision) e lo stampa una riga per frase.
// Uso: swift prove/testo.swift schermata.png
import Foundation
import Vision

let percorso = CommandLine.arguments[1]
guard let immagine = NSURL(fileURLWithPath: percorso) as URL?,
      let dati = try? Data(contentsOf: immagine) else {
    FileHandle.standardError.write("Immagine non leggibile: \(percorso)\n".data(using: .utf8)!)
    exit(1)
}
let richiesta = VNRecognizeTextRequest()
richiesta.recognitionLevel = .accurate
richiesta.recognitionLanguages = ["it-IT", "en-US"]
richiesta.usesLanguageCorrection = false
try VNImageRequestHandler(data: dati, options: [:]).perform([richiesta])
for risultato in richiesta.results ?? [] {
    if let testo = risultato.topCandidates(1).first?.string { print(testo) }
}
