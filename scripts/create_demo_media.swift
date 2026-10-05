import AppKit
import AVFoundation
import CoreVideo

// Geometric CCTV rehearsal footage, explicitly synthetic. No footage of real people.
let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let resource = root.appendingPathComponent("iOS/Resources", isDirectory: true)
try FileManager.default.createDirectory(at: resource, withIntermediateDirectories: true)
let destination = resource.appendingPathComponent("demo-incident.mp4")
try? FileManager.default.removeItem(at: destination)
let writer = try AVAssetWriter(outputURL: destination, fileType: .mp4)
let width = 960, height = 540
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height])
let adapter = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB, kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height])
writer.add(input); writer.startWriting(); writer.startSession(atSourceTime: .zero)
func text(_ string: String, _ x: Double, _ y: Double, _ size: Double, _ color: NSColor = .white) {
    (string as NSString).draw(at: NSPoint(x: x, y: y), withAttributes: [.font: NSFont.monospacedSystemFont(ofSize: size, weight: .medium), .foregroundColor: color])
}
for frame in 0..<180 {
    while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.003) }
    var buffer: CVPixelBuffer?; CVPixelBufferCreate(nil, width, height, kCVPixelFormatType_32ARGB, nil, &buffer)
    let pixel = buffer!; CVPixelBufferLockBaseAddress(pixel, [])
    let context = CGContext(data: CVPixelBufferGetBaseAddress(pixel), width: width, height: height, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(pixel), space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)!
    let graphics = NSGraphicsContext(cgContext: context, flipped: false)
    NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = graphics
    func rect(_ x: Double, _ y: Double, _ w: Double, _ h: Double, _ gray: Double) { context.setFillColor(CGColor(gray: gray, alpha: 1)); context.fill(CGRect(x: x, y: y, width: w, height: h)) }
    rect(0, 0, 960, 540, 0.12); rect(0, 0, 960, 190, 0.28); rect(160, 180, 680, 300, 0.4)
    rect(530, 190, 110, 220, 0.14); rect(240, 310, 160, 100, 0.16); rect(255, 320, 130, 80, 0.5)
    rect(735, 210, 85, 205, 0.22)
    context.setStrokeColor(CGColor(gray: 0.47, alpha: 1)); context.setLineWidth(2)
    for row in stride(from: 190, to: 475, by: 30) { context.move(to: CGPoint(x: 160, y: row)); context.addLine(to: CGPoint(x: 840, y: row)); context.strokePath() }
    let x = 230 + min(Double(frame) * 4, 310)
    rect(x - 17, 138, 34, 84, 0.08); rect(x - 17, 91, 12, 52, 0.08); rect(x + 5, 91, 12, 52, 0.08)
    context.setFillColor(CGColor(gray: 0.65, alpha: 1)); context.fillEllipse(in: CGRect(x: x - 16, y: 220, width: 32, height: 32))
    context.setStrokeColor(NSColor.systemYellow.cgColor); context.setLineWidth(3); context.stroke(CGRect(x: x - 32, y: 84, width: 64, height: 180))
    text("REAR DOOR  /  SYNTHETIC DEMO", 24, 496, 22)
    text(String(format: "14:42:%02d", frame / 15), 774, 496, 20)
    text(frame < 80 ? "PERSON APPROACHING" : "PERSISTENT REAR-DOOR ACTIVITY", 24, 24, 22)
    text("ILLUSTRATION · NOT RING RECORDING", 24, 60, 18, .systemYellow)
    NSGraphicsContext.restoreGraphicsState(); CVPixelBufferUnlockBaseAddress(pixel, [])
    adapter.append(pixel, withPresentationTime: CMTime(value: Int64(frame), timescale: 15))
}
input.markAsFinished()
let finished = DispatchSemaphore(value: 0); writer.finishWriting { finished.signal() }; finished.wait()
guard writer.status == .completed else { fatalError(writer.error?.localizedDescription ?? "Media encoding failed") }
let iconDir = resource.appendingPathComponent("Assets.xcassets/AppIcon.appiconset")
try FileManager.default.createDirectory(at: iconDir, withIntermediateDirectories: true)
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
let previousContext = NSGraphicsContext.current
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSColor(calibratedRed: 0.03, green: 0.23, blue: 0.5, alpha: 1).setFill(); NSRect(x: 0, y: 0, width: 1024, height: 1024).fill()
("RD" as NSString).draw(in: NSRect(x: 136, y: 265, width: 820, height: 580), withAttributes: [.font: NSFont.systemFont(ofSize: 410, weight: .bold), .foregroundColor: NSColor.white])
NSGraphicsContext.current = previousContext
try rep.representation(using: .png, properties: [:])!.write(to: iconDir.appendingPathComponent("AppIcon.png"))
try Data(#"{"images":[{"filename":"AppIcon.png","idiom":"universal","platform":"ios","size":"1024x1024"}],"info":{"author":"xcode","version":1}}"#.utf8).write(to: iconDir.appendingPathComponent("Contents.json"))
try Data(#"{"info":{"author":"xcode","version":1}}"#.utf8).write(to: resource.appendingPathComponent("Assets.xcassets/Contents.json"))
try Data(#"{"origin":"Authored locally by scripts/create_demo_media.swift","media":"Geometric synthetic CCTV rehearsal, no real person or Ring recording","icon":"Original RD lettering, no Ring trademark asset"}"#.utf8).write(to: resource.appendingPathComponent("PROVENANCE.json"))
print("Created synthetic demo media and original app icon")
