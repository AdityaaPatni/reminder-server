import UIKit

struct WhatsAppService {

    /// Opens WhatsApp with phone number pre-filled and message text.
    /// Returns true if WhatsApp was launched successfully.
    @discardableResult
    static func send(to phoneNumber: String, message: String) -> Bool {
        let digits = phoneNumber.components(separatedBy: CharacterSet.decimalDigits.inverted).joined()
        guard !digits.isEmpty else { return false }

        let encoded = message.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? message

        // Try WhatsApp deep link first
        if let url = URL(string: "whatsapp://send?phone=\(digits)&text=\(encoded)"),
           UIApplication.shared.canOpenURL(url) {
            UIApplication.shared.open(url)
            return true
        }

        // Fallback to universal link (opens WhatsApp or web)
        if let url = URL(string: "https://wa.me/\(digits)?text=\(encoded)") {
            UIApplication.shared.open(url)
            return true
        }

        return false
    }

    static var isInstalled: Bool {
        guard let url = URL(string: "whatsapp://") else { return false }
        return UIApplication.shared.canOpenURL(url)
    }
}
