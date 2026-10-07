// Legge il testo di una schermata (OCR di macOS, framework Vision).
// Uso: testo schermata.png            stampa il testo, una riga per frase
//      testo schermata.png "Avanti"   stampa dove sta la scritta: "x y" da 0 a 1, dall'angolo in alto a
//                                     sinistra (prima la riga uguale, poi quella che la contiene); esce con 1
//                                     se non c'è
// (prove/ios.sh lo compila con swiftc: interpretato, swift impiega secondi a ogni lettura)
import Foundation
import Vision

let percorso = CommandLine.arguments[1]
let cercato = CommandLine.arguments.count > 2 ? CommandLine.arguments[2].lowercased() : nil
guard let dati = try? Data(contentsOf: URL(fileURLWithPath: percorso)) else {
    FileHandle.standardError.write("Immagine non leggibile: \(percorso)\n".data(using: .utf8)!)
    exit(1)
}
let richiesta = VNRecognizeTextRequest()
richiesta.recognitionLevel = .accurate
richiesta.recognitionLanguages = ["it-IT", "en-US"]
richiesta.usesLanguageCorrection = false
try VNImageRequestHandler(data: dati, options: [:]).perform([richiesta])
let righe = (richiesta.results ?? []).compactMap { r -> (String, CGRect)? in
    guard let t = r.topCandidates(1).first?.string else { return nil }
    return (t, r.boundingBox)
}
guard let cercato else {
    for (testo, _) in righe { print(testo) }
    exit(0)
}
let pulito = { (s: String) in s.lowercased().trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters)) }
let uguale = righe.first(where: { pulito($0.0) == cercato })
let trovata = uguale ?? righe.first(where: { $0.0.lowercased().contains(cercato) })
guard let riga = trovata else { exit(1) }
// Vision misura dal basso a sinistra; il tocco va dall'alto a sinistra.
print(String(format: "%.4f %.4f", riga.1.midX, 1 - riga.1.midY))
