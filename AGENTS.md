# AGENTS

## エージェント方針 / Agent Policy

### 1. 概要 (日本語)
- この VS Code 拡張機能は JavaScript のみで構築されています。
- すべてのユーザー向けメッセージは、実行環境の言語を判定して日本語と英語を自動で切り替えます。
- エージェントからの応答は既定で日本語です。必要に応じて英語訳を追加する場合は、利用者のロケールを確認してから提供します。
- コード内のコメントは英語で統一し、説明責務を明確にします。
- 新しい機能を追加する際は既存の 	() ローカライズ関数と _isJa フラグを活用し、文字列を package.nls*.json に登録してください。

### 2. Overview (English)
- This VS Code extension is implemented entirely in JavaScript.
- User-facing messages must automatically switch between Japanese and English based on the host environment.
- Agent replies should default to Japanese; provide English equivalents only when the detected locale indicates a non-Japanese preference.
- Keep code comments in English to keep technical explanations concise and accessible to collaborators.
- When adding features, continue to rely on the existing 	() localization helper and _isJa flag, and register new strings in package.nls*.json.

### 3. プロファイルとドキュメント運用 / Profiles & Documentation
- プロファイルや設定ファイルに関する変更は、アクティブなスケッチのコンテキストを優先して反映させること。
- ドキュメントは日本語を主としつつ、国際的な貢献者向けに対応する英語節を併記します。
- 変更点は CHANGELOG.md と Git コミットメッセージで二言語対応を意識してください。

### 4. テストとレビュー / Testing & Review
- ローカライズに関わる変更では、日本語と英語の両方の UI メッセージを確認します。
- 可能な限り VS Code の拡張機能テスト (Extension Tests) を用いて回帰を防ぎ、結果を共有する際も二言語の要約を心掛けてください。
