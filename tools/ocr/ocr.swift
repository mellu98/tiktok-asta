// OCR dello schermo Android con Vision (macOS), per leggere la card asta di
// TikTok: uiautomator non la legge sulle LIVE (stato idle mai raggiunto, testi
// non esposti all'accessibilità).
//
// Uso:
//   adb exec-out screencap | ocr --raw [--save frame.jpg] [--roi-top 0.45] [--fast]
//   ocr immagine1.png [immagine2.jpg …]          (debug su file)
//
// Output: una riga JSON per immagine
//   {"w":1080,"h":2400,"ms":310,"lines":[{"text":"Offri 14 €","conf":1,"x1":…,"y1":…,"x2":…,"y2":…}]}
// Coordinate in pixel dello schermo, origine in alto a sinistra (come adb input tap).

import AppKit
import Foundation
import Vision

struct Line: Codable {
    let text: String
    let conf: Float
    let x1: Int
    let y1: Int
    let x2: Int
    let y2: Int
}

struct Output: Codable {
    let w: Int
    let h: Int
    let ms: Int
    let lines: [Line]
}

struct OcrError: Error, CustomStringConvertible {
    let description: String
}

/// Formato `screencap` raw: header (w, h, format[, colorspace]) little-endian + pixel RGBA.
func imageFromRawScreencap(_ data: Data) throws -> CGImage {
    guard data.count > 16 else { throw OcrError(description: "screencap raw troppo corto (\(data.count) byte)") }
    func u32(_ offset: Int) -> Int {
        data.subdata(in: offset..<(offset + 4)).withUnsafeBytes { Int(UInt32(littleEndian: $0.load(as: UInt32.self))) }
    }
    let width = u32(0), height = u32(4), format = u32(8)
    let pixelBytes = width * height * 4
    let headerSize = data.count - pixelBytes
    guard width > 0, height > 0, headerSize == 12 || headerSize == 16 else {
        throw OcrError(description: "header screencap non valido (\(width)x\(height), \(data.count) byte)")
    }
    guard format == 1 || format == 2 else {
        throw OcrError(description: "formato pixel screencap non supportato: \(format) (atteso RGBA_8888)")
    }
    let pixels = data.subdata(in: headerSize..<data.count)
    guard let provider = CGDataProvider(data: pixels as CFData),
          let image = CGImage(
              width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32,
              bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
              bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue),
              provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
    else { throw OcrError(description: "impossibile costruire l'immagine dal screencap raw") }
    return image
}

func saveJpeg(_ image: CGImage, to path: String) throws {
    let rep = NSBitmapImageRep(cgImage: image)
    guard let jpeg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.6]) else {
        throw OcrError(description: "codifica JPEG non riuscita")
    }
    try jpeg.write(to: URL(fileURLWithPath: path))
}

func recognize(_ image: CGImage, roiTop: Double, fast: Bool) throws -> [Line] {
    let w = CGFloat(image.width), h = CGFloat(image.height)
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = fast ? .fast : .accurate
    request.recognitionLanguages = ["it-IT", "en-US"]
    request.usesLanguageCorrection = false
    // Vision: coordinate normalizzate con origine in BASSO a sinistra.
    request.regionOfInterest = CGRect(x: 0, y: 0, width: 1, height: 1 - roiTop)
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    return (request.results ?? []).compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        // boundingBox è relativo alla ROI: riportato all'immagine intera.
        let box = VNImageRectForNormalizedRect(observation.boundingBox, Int(w), Int(h * (1 - roiTop)))
        return Line(
            text: candidate.string, conf: candidate.confidence,
            x1: Int(box.minX), y1: Int(h - box.maxY), x2: Int(box.maxX), y2: Int(h - box.minY))
    }
}

func emit(_ output: Output) {
    let data = try! JSONEncoder().encode(output)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

var args = Array(CommandLine.arguments.dropFirst())
func takeOption(_ name: String) -> String? {
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    let value = args[i + 1]
    args.removeSubrange(i...(i + 1))
    return value
}
func takeFlag(_ name: String) -> Bool {
    guard let i = args.firstIndex(of: name) else { return false }
    args.remove(at: i)
    return true
}

let savePath = takeOption("--save")
let roiTop = min(0.9, max(0, Double(takeOption("--roi-top") ?? "0") ?? 0))
let fast = takeFlag("--fast")
let raw = takeFlag("--raw")

do {
    if raw {
        let input = FileHandle.standardInput.readDataToEndOfFile()
        let start = Date() // solo OCR (+ JPEG): il trasferimento adb lo misura il chiamante
        let image = try imageFromRawScreencap(input)
        let lines = try recognize(image, roiTop: roiTop, fast: fast)
        if let savePath { try saveJpeg(image, to: savePath) }
        emit(Output(w: image.width, h: image.height, ms: Int(Date().timeIntervalSince(start) * 1000), lines: lines))
    } else {
        guard !args.isEmpty else { throw OcrError(description: "uso: ocr --raw [--save f.jpg] [--roi-top 0.45] [--fast] | ocr immagini…") }
        for path in args {
            let start = Date()
            guard let ns = NSImage(contentsOfFile: path),
                  let image = ns.cgImage(forProposedRect: nil, context: nil, hints: nil)
            else { throw OcrError(description: "immagine non leggibile: \(path)") }
            let lines = try recognize(image, roiTop: roiTop, fast: fast)
            emit(Output(w: image.width, h: image.height, ms: Int(Date().timeIntervalSince(start) * 1000), lines: lines))
        }
    }
} catch {
    FileHandle.standardError.write("ocr: \(error)\n".data(using: .utf8)!)
    exit(1)
}
