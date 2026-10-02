using System;
using System.IO;
using System.Text;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Collections.Generic;

// Installer helper. Contains only the public key; it cannot issue licenses.
class LicenseVerifier {
  static byte[] Decode(string value) {
    if (!Regex.IsMatch(value, "^[A-Za-z0-9_-]+$")) throw new Exception();
    string s = value.Replace('-', '+').Replace('_', '/');
    byte[] bytes = Convert.FromBase64String(s.PadRight((s.Length + 3) / 4 * 4, '='));
    if (Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_') != value) throw new Exception();
    return bytes;
  }
  static int Main(string[] args) {
    try {
      if (args.Length != 1 || new FileInfo(args[0]).Length > 4096) return 2;
      string token = Regex.Replace(File.ReadAllText(args[0], Encoding.UTF8), @"\s", "");
      string[] parts = token.Split('.');
      if (parts.Length != 3 || parts[0] != "YY1") return 2;
      byte[] body = Decode(parts[1]), signature = Decode(parts[2]);
      using (var rsa = new RSACryptoServiceProvider()) {
        rsa.PersistKeyInCsp = false;
        rsa.ImportParameters(new RSAParameters {
          Modulus = Convert.FromBase64String("__PUBLIC_MODULUS__"),
          Exponent = Convert.FromBase64String("__PUBLIC_EXPONENT__")
        });
        if (!rsa.VerifyData(Encoding.ASCII.GetBytes("YY1." + parts[1]), CryptoConfig.MapNameToOID("SHA256"), signature)) return 2;
      }
      var p = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(body));
      if (p == null || p.Count != 5 || !p.ContainsKey("version") || !p.ContainsKey("product") || !p.ContainsKey("id") || !p.ContainsKey("customer") || !p.ContainsKey("issuedAt")) return 2;
      if (!(p["version"] is int) || (int)p["version"] != 1 || (p["product"] as string) != "exam-proctor-desktop") return 2;
      string customer = p["customer"] as string, id = p["id"] as string, issuedAt = p["issuedAt"] as string;
      DateTime parsed;
      if (String.IsNullOrWhiteSpace(customer) || customer.Length > 60 || id == null || !Regex.IsMatch(id, "^[a-f0-9-]{36}$")) return 2;
      if (issuedAt == null || !Regex.IsMatch(issuedAt, @"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$") || !DateTime.TryParse(issuedAt, out parsed)) return 2;
      return 0;
    } catch { return 2; }
  }
}
