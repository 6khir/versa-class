import Foundation
import Vision
import ImageIO
guard CommandLine.arguments.count == 2 else { exit(2) }
let request = VNRecognizeTextRequest()
request.usesCPUOnly = true
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
do {
    try VNImageRequestHandler(url: URL(fileURLWithPath: CommandLine.arguments[1])).perform([request])
    let texts = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    let result: [String: Any] = ["textFree": true, "method": "AppleVision", "validatorVersion": "1", "detections": texts]
    print(String(data: try JSONSerialization.data(withJSONObject: result), encoding: .utf8)!)
} catch { fputs("Artwork text detection failed: \(error)\n", stderr); exit(1) }
