import Foundation
import Vision
import ImageIO
import CoreGraphics

guard CommandLine.arguments.count >= 2 else {
    fputs("usage: recognize-page-text <image>\n", stderr)
    exit(2)
}

let path = CommandLine.arguments[1]
let url = URL(fileURLWithPath: path)
guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fputs("recognize-page-text: cannot open image\n", stderr)
    exit(1)
}

let width = CGFloat(image.width)
let height = CGFloat(image.height)
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["en-US"]
request.minimumTextHeight = 0.008
if #available(macOS 13.0, *) {
    request.automaticallyDetectsLanguage = false
}

do {
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
} catch {
    fputs("recognize-page-text failed: \(error)\n", stderr)
    exit(1)
}

var runs: [[String: Any]] = []
for observation in request.results ?? [] {
    guard let candidate = observation.topCandidates(1).first else { continue }
    let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
    if text.isEmpty { continue }
    let box = observation.boundingBox
    let x0 = box.origin.x * width
    let y0 = (1.0 - box.origin.y - box.size.height) * height
    let x1 = x0 + (box.size.width * width)
    let y1 = y0 + (box.size.height * height)
    runs.append([
        "text": text,
        "confidence": candidate.confidence,
        "box": [x0, y0, x1, y1]
    ])
}

let payload: [String: Any] = [
    "ok": true,
    "engine": "apple-vision",
    "width": Int(width),
    "height": Int(height),
    "text": runs
]
let data = try JSONSerialization.data(withJSONObject: payload, options: [])
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data([0x0A]))
