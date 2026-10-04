import AppKit
import Foundation

guard CommandLine.arguments.count == 3 else {
    FileHandle.standardError.write(Data("usage: rasterize-svg.swift input.svg output.png\n".utf8))
    exit(2)
}

guard let image = NSImage(contentsOfFile: CommandLine.arguments[1]),
      let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let png = bitmap.representation(using: .png, properties: [:]) else {
    throw NSError(domain: "rasterize-svg", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not rasterize SVG"])
}
try png.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
