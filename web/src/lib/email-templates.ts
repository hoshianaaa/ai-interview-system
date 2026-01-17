export const CANDIDATE_EMAIL_TEMPLATE_VARIABLES = [
  { key: "orgName", label: "組織名" },
  { key: "userName", label: "ユーザー名" },
  { key: "interviewUrl", label: "面接URL" },
  { key: "expiresAt", label: "URL有効期限" }
] as const;

export const DEFAULT_CANDIDATE_EMAIL_TEMPLATE = `{{orgName}} 採用担当の {{userName}} です。この度は、弊社の求人にご応募いただき誠にありがとうございます。

書類選考の結果、ぜひ次のステップとして「AI面接」にお進みいただきたくご連絡いたしました。本選考は、お手持ちのスマートフォンやPCから、ご都合の良いタイミングで受検いただけるビデオ形式の面接です。

以下の詳細をご確認のうえ、期限までにご実施をお願いいたします。

■AI面接 実施概要
受検期限： {{expiresAt}}

所要時間： 約15分〜20分

受検用URL： {{interviewUrl}}

■受検にあたっての準備
環境： 静かな場所で、カメラとマイクが使用できる環境をご用意ください。

端末： スマートフォンまたはPC（ブラウザは最新版を推奨します）。

服装： 私服で構いません（リラックスして臨んでいただける格好で問題ありません）。

■注意事項
途中で通信が切れないよう、Wi-Fi環境の安定した場所での受検を推奨いたします。`;
