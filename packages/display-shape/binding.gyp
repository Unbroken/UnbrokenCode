{
  "targets": [
    {
      "target_name": "display_shape",
      "conditions": [
        ["OS=='mac'", {
          "sources": ["src/display_shape.mm"],
          "link_settings": {
            "libraries": ["$(SDKROOT)/System/Library/Frameworks/AppKit.framework"]
          },
          "xcode_settings": {
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "MACOSX_DEPLOYMENT_TARGET": "12.0",
            "OTHER_CFLAGS": ["-Wall", "-Wextra"]
          }
        }, {
          "sources": ["src/display_shape_stub.cc"]
        }]
      ]
    }
  ]
}
