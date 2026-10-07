// Legge il testo di una schermata (OCR di macOS, framework Vision) e lo stampa una riga per frase.
// Uso: testo schermata.png  (prove/ios.sh lo compila con swiftc: interpretato, swift impiega secondi a ogni lettura)
import Foundation
import Vision

let percorso = CommandLine.arguments[1]
guard let dati = try? Data(contentsOf: URL(fileURLWithPath: percorso)) else {
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
