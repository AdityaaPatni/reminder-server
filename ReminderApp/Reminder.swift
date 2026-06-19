import Foundation

struct Reminder: Identifiable, Codable {
    let id: UUID
    var title: String
    var body: String
    var date: Date
    var whatsappEnabled: Bool
    var phoneNumber: String

    init(id: UUID = UUID(),
         title: String,
         body: String = "",
         date: Date,
         whatsappEnabled: Bool = false,
         phoneNumber: String = "") {
        self.id = id
        self.title = title
        self.body = body
        self.date = date
        self.whatsappEnabled = whatsappEnabled
        self.phoneNumber = phoneNumber
    }
}
