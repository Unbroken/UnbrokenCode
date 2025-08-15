# Unbroken Code - The VS Code Fork That Actually Works for C++ Developers

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/Unbroken/UnbrokenCode)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE.txt)
[![Based on VS Code](https://img.shields.io/badge/Based%20on-VS%20Code-blue)](https://github.com/microsoft/vscode)

## The IDE That Ships What You Actually Need

<p align="center">
  <img width="828" height="584" alt="Unbroken Code in action" src="https://github.com/user-attachments/assets/7598487a-04d4-4c97-9cf6-e9195ca337fa">
</p>

**Unbroken Code** is a supercharged fork of Visual Studio Code, meticulously enhanced for C++ developers and everyone else who are tired of waiting for *those* pull requests to be approved upstream. You know, the ones that are "too useful" or "too specific" for the general audience. We ship them anyway.

## Why Unbroken Code?

Let's be honest - VS Code is great, but when you're deep in C++ development, you need more than great. You need **unbroken**. This fork includes all those patches that somehow never quite make it upstream (we wonder why 🤔), plus enhancements specifically tailored for serious C++ development.

### 🚀 Key Enhancements Over Standard VS Code

#### **Productivity Unleashed**
- **Smart Problem Navigation** - actually remembers where you were when problems disappear, with automatic synchronization between marker navigation and the problems panel
- **Sequential Problem Output** - problems appear in the order they occur (revolutionary, right?)
- **Silent Find Commands** - navigate search matches without opening the find widget for a cleaner, less intrusive search experience
- **Better Search Result Navigation** - keyboard shortcuts that actually work as expected
- **Git Repository Filtering** - hide unchanged repos because clutter is the enemy
- **External Git UI Integration** - seamlessly launch Sublime Merge, Sourcetree, GitKraken, Tower, or GitHub Desktop directly from the editor with commands for repository, file history, line history, and blame views
- **More items in title bar** - use that space for something useful
- **Minimal layout by default** - less chrome, more code
- **Better Navigation**
	- Consistent word based navigation: Search for SingleSeparator in keyboard shortcuts
	- Consistent navigation around decorations such as inlay hints
	- **File Explorer Leaf Navigation** - jump directly to next/previous file (skipping folders) with optional auto-expand for seamless tree traversal

#### **Developer Experience First**
- **Telemetry OFF by default** - your code is your business
- **Open VSX marketplace** - freedom of choice in extensions
- **Compatible 'code' command** - works with all your existing tools and workflows
- **GitHub Copilot Chat** - bundled as an integrated extension for modern AI-assisted development
- **'isUnbroken' context key** - create custom keybindings specific to Unbroken Code, useful when switching between editors
- **Extension Quarantine Security** - automatic protection against supply chain attacks by quarantining newly released extension versions (default: 7 days, configurable)

### 🎨 Clean, Efficient Interface
- Waste less space in UI - every pixel counts
- Layout icons stay visible even with editor actions in title bar
- Thoughtfully designed defaults for a minimal, distraction-free experience
- Cleaner centered layout that actually centers on screen instead of in editor window and uses all available space to the right (and centering is configurable as default for new workspaces)
- **Problems panel in primary sidebar** - better default location than the bottom panel for a cleaner workflow, and updated rendering that prioritizes the error message making the sidebar location feasible

#### **Better editor experience**
- **Enhanced color space control** for syntax highlighting and all themed colors - your eyes will thank you
- **Smart Inlay Hints** - defaults to "offUnlessPressed" mode (show only when holding Ctrl/Cmd)
- **Smaller error squiggles** - see your actual code, not just red lines
- **Optimized underline positioning** for smaller fonts - pixel-perfect at any zoom level
- **Editor ruler at 190** - opinionated default, matching the default font which is 6 px wide.

#### **C++ Development Superpowers**
- **Malterlib Extension** shipped by default - because why wouldn't you want this?
- **C++ extensions** shipped by default - enhanced versions of ClangD and CodeLLDB extensions
- **Advanced Problem Matchers** with categorized sub-problems - finally, build errors that make sense

## Installation

Download the latest release for your platform:

**[📥 Download Unbroken Code](https://github.com/Unbroken/UnbrokenCode/releases/latest)**

### macOS

#### Recommended: Disable Font Smoothing for Pixel-Perfect Rendering
For the best experience with Unbroken Code's crisp font rendering, disable font smoothing system-wide:

```bash
defaults -currentHost write -g AppleFontSmoothing -int 0
```

This enables pixel-perfect font rendering that matches the precision of the built-in font. To re-enable font smoothing later:

```bash
defaults -currentHost delete -g AppleFontSmoothing
```

Note: This is a system-wide setting that affects all applications. You'll need to log out and back in for the change to take full effect.

**Why disable font smoothing?** Apple's font smoothing makes text appear bold and blurry, especially on non-Retina displays. For a detailed explanation, see [this excellent article by Nikita Prokopov](https://tonsky.me/blog/monitors/#turn-off-font-smoothing) on why font smoothing is problematic and how it destroys text clarity.

## Building from Source

Want to build your own? Check out the upstream [build instructions](https://github.com/microsoft/vscode/wiki/How-to-Contribute) - they still apply here, but now you get all the good stuff included.

## Documentation

For general VS Code documentation, features, and guides, see the [upstream README](https://github.com/microsoft/vscode/blob/main/README.md) and [official documentation](https://code.visualstudio.com/docs).

## Why This Fork Exists

Sometimes the best features are the ones that are "too opinionated" or "too niche" for mainstream adoption. We disagree. If it makes developers more productive, especially in C++ development, it belongs in the editor. This fork is for developers who want their tools to just work, without compromise.

## Contributing

Found another patch that's too useful for upstream? We'd love to see it! Open an issue or submit a PR. We're particularly interested in:
- C++ development enhancements
- Build system improvements
- Performance optimizations
- Developer productivity features

## License

Like VS Code, Unbroken Code is licensed under the [MIT License](LICENSE.txt).

## Acknowledgments

Built on the excellent foundation of [Visual Studio Code](https://github.com/microsoft/vscode). We stand on the shoulders of giants, we just give them better shoes.

---

*Unbroken Code - Because broken workflows break developers.*
