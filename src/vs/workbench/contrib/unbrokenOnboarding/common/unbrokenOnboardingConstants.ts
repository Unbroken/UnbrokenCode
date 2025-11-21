/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const UNBROKEN_ONBOARDING_STORAGE_KEY = 'unbrokenOnboarding.completed';

export const SAMPLE_CPP_CODE = `#include <Mib/Web/Curl>
#include <Mib/Encoding/JsonShortcuts>

namespace NMib::NGit
{
	TCFuture<CJsonSorted> CGitHostingProvider_GitHub::fp_GraphQlApi(CStr _Query, CJsonSorted _Variables)
	{
		TCMap<CStr, CStr> Headers{{"User-Agent", "MalterlibGitHostingProvider"}};

		if (mp_Token)
			Headers["Authorization"] = "Bearer {}"_f << mp_Token;

		auto Result = co_await mp_CurlActor
			(
				&CCurlActor::f_Request
				, CCurlActor::EMethod_POST
				, "https://api.github.com/graphql"
				, CJsonSorted
				{
					"query"_j= fg_Move(_Query)
					, "variables"_j= fg_Move(_Variables)
				}
				, CByteVector::fs_FromString(QueryJson.f_ToString())
				, TCMap<CStr, CStr>{}
			)
		;

		if (Result.m_StatusCode != 200)
		{
			CStr Error = Result.m_Body;

			co_return DMibErrorInstance
				(
					"GitHub request failed with status {} ({}): {}"_f
					<< Result.m_StatusCode
					<< Result.m_StatusMessage
					<< Result.m_Body
				)
			;
		}

		auto CaptureScope = co_await g_CaptureExceptions;

		auto ResultJson = CJsonSorted::fs_FromString(Result.m_Body);

		if (auto pErrors = ResultJson.f_GetMember("errors", EJsonType_Array))
		{
			for (auto &Error : fg_Const(pErrors->f_Array()))
			{
				if (auto *pMessage = Error.f_GetMember("message", EJsonType_String))
					co_return DMibErrorInstance("GitHub GraphQL request failed: {}"_f << pMessage->f_String());
				else
					co_return DMibErrorInstance("GitHub GraphQL request failed: {}"_f << Error);
			}
		}

		co_return fg_Move(ResultJson);
	}
}`;

// Annotated C++ sample for explaining the color design philosophy
export const SAMPLE_CPP_COLOR_DESIGN = `#include <Mib/Core/Core>

namespace NTest
{
	template
	<
		typename t_CType                                // Template type parameter distinguishable
		, int t_NonType
	>
	struct TCType                                       // Generic types
	{
		template
		<
			typename tf_CTest                           // Template function type parameter distinguishable
		>
		void f_TestParameters
			(
				uint32 _FunctionParameter               // Function parameter
				, uint32 &o_OutputFunctionParameter     // Output function parameter distinguishable
			) const
		{
			o_OutputFunctionParameter = _FunctionParameter;
		}

		void f_TestVariables()
		{
			auto pAutoVar = nullptr;                    // Local variables have distinct color

			m_VariablePublic = 0;                       // Public member variable
			mp_VariablePrivate = 0;                     // Private/protected variables easily distinguishable

			bool bValue         = true;                 // All public constant values have the same color
			ETest EnumValue     = ETest_Value;          // Enum type distinguishable from enum values
			auto ConstantValue  = mc_ConstantPublic;    // Constant variables easily seen
			auto ConstantValue2 = mcp_ConstantPrivate;  // Private/protected constant variables distinguishable
			auto ConstantValue3 = tf_Test;              // Function template constants distinguishable
			auto ConstantValue4 = t_Test;               // Class template constants distinguishable
			auto ConstantValue5 = 5.5;                  // Numeric constants distinguishable

			g_GlobalVariable = 0;                       // Global variables - Instantly see danger by red color
			ms_StaticVariablePublic = 0;                // Public static member variable
			msp_StaticVariablePrivate = 0;              // Private/protected static member variable distinguishable from public
		}

		void f_TestFunctions()
		{
			f_FunctionPublic();                         // Member functions
			fs_StaticFunctionPublic();

			fp_FunctionPrivate();                       // Private/protected member functions distinguishable from public
			fsp_StaticFunctionPrivate();

			fg_GlobalFunction();                        // Global functions distinguishable from member functions
		}

		void f_TestFunctors
			(
				TCFunction<void ()> const &_fFunctor    // Functors distinguishable from other variables and functions
				, TCFunction<void ()> &o_fFunctor       // Output functor distinguishable
			) const
		{
			auto fFunctor = []
				{
				}
			;

			o_fFunctor = fFunctor;
														// All 5 functor types distinguishable from each other
			m_fFunctor();                               // Member variable
			mp_fFunctor();                              // Private member variable
			fFunctor();                                 // Local variable
			_fFunctor();                                // Function parameter
			o_fFunctor();                               // Output function parameter

			fFunctor.f_Clear();
		}

		void f_FunctionPublic();
		static void fs_StaticFunctionPublic();

		NMib::NFunction::TCFunction<void ()> m_fFunctor;

		uint32 m_VariablePublic;
		static uint32 ms_StaticVariablePublic;
		constexpr uint32 mc_ConstantPublic = 0;

	private:
		NMib::NFunction::TCFunction<void ()> mp_fFunctor;

		uint32 mp_VariablePrivate;
		static uint32 msp_StaticVariablePrivate;
		constexpr static uint32 mcp_ConstantPrivate = 0;

		void fp_FunctionPrivate();
		static void fsp_StaticFunctionPrivate();
	};

	template <typename tf_CType, int tf_NonType, int ...tfp_Values>
	void inline fg_FunctionGlobal();

	enum ETest
	{
		ETest_Value
	};
}

#define DMacro(d_MacroParameter) \\
	d_MacroParameter

auto g_String = "String";
auto g_Char = 'C';
[[maybe_unused]] const static uint32 gc_GlobalConstant = (55 + 5 * 6 % ((67 | 77) & 88));
[[maybe_unused]] static int gs_ThousandsSeparator = 10'000'000;
double g_Double = 5.655 + 7.66e10;

template <typename t_CType>
concept cComparable = true;

// Language
= * + - % {} [] () <>                                           // #ffffff
#include                                                        // #ffffff
for {} if {} while {} do {}                                     // #ffffff
typename                                                        // #c0c0c0
inline                                                          // #c0c0c0
\\                                                               // #808080
public private protected friend                                 // #ffc8ca
const volatile                                                  // #ffb680

// Builtin types
int bool void uint32                                            // #ff5966

// Constant values
15 60.6                                                         // #ff0080
t_Test                                                          // #ff5bad
gc_Test ETest_Value mc_Test gc_Test c_Test true false nullptr   // #ff8ac5
mcp_Test                                                        // #ca97b1
tf_Test                                                         // #ffb7db

// Character
'T'                                                             // #ff48f0

// Namespace
NTest                                                           // #d785ff

// Types
t_CTest t_TCTest                                                // #8269ff
tf_CTest tf_TCTest                                              // #cdc3ff
CTest TCTest ETest                                              // #b8aaff
auto                                                            // #dbd3ff

// String
"String"                                                        // #009eff

// Functors
_fTest 	                                                        // #00e4e6
o_fTest                                                         // #36e8cd
fTest                                                           // #00edae
m_fTest                                                         // #00f265
mp_fTest                                                        // #4fc17e

// Functions
f_Test fs_Test                                                  // #26ff00
fg_Test fsg_Test                                                // #1cb900
fp_Test fsp_Test                                                // #8dd580

// Parameters
_Test p_Test                                                    // #e6ff00
o_Test po_Test                                                  // #fff54b

// Variables
Var                                                             // #ffd700

// Concepts
cComparable                                                     // #ffb680

// Member variables
m_Test                                                          // #ffa600
mp_Test                                                         // #c59d53

// Macros
DTest                                                           // #ff7700
d_Test                                                          // #ffbc81

// Globals
ms_Test                                                         // #ff3f1c
g_Test gs_Test                                                  // #e13819
msp_Test                                                        // #d56955
`;

export const SAMPLE_TYPESCRIPT_CODE = `import { EventEmitter } from 'events';
import { WebSocket } from 'ws';

interface GitHubGraphQLResponse<T = any> {
	data?: T;
	errors?: Array<{
		message: string;
		locations?: Array<{ line: number; column: number }>;
		path?: string[];
	}>;
}

export class GitHubGraphQLClient extends EventEmitter {
	private token?: string;
	private baseUrl = 'https://api.github.com/graphql';

	constructor(token?: string) {
		super();
		this.token = token;
	}

	async query<T = any>(query: string, variables?: Record<string, any>): Promise<T> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			'User-Agent': 'MalterlibGitHostingProvider',
		};

		if (this.token) {
			headers['Authorization'] = \`Bearer \${this.token}\`;
		}

		const response = await fetch(this.baseUrl, {
			method: 'POST',
			headers,
			body: JSON.stringify({ query, variables }),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(
				\`GitHub request failed with status \${response.status} (\${response.statusText}): \${errorText}\`
			);
		}

		const result: GitHubGraphQLResponse<T> = await response.json();

		if (result.errors && result.errors.length > 0) {
			const errorMessages = result.errors.map((err) => err.message).join(', ');
			throw new Error(\`GitHub GraphQL request failed: \${errorMessages}\`);
		}

		if (!result.data) {
			throw new Error('GitHub GraphQL response missing data field');
		}

		return result.data;
	}
}`;

export const SAMPLE_RUST_CODE = `use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize)]
struct GraphQLError {
	message: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	locations: Option<Vec<Location>>,
	#[serde(skip_serializing_if = "Option::is_none")]
	path: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Location {
	line: usize,
	column: usize,
}

#[derive(Debug, Serialize, Deserialize)]
struct GraphQLResponse<T> {
	#[serde(skip_serializing_if = "Option::is_none")]
	data: Option<T>,
	#[serde(skip_serializing_if = "Option::is_none")]
	errors: Option<Vec<GraphQLError>>,
}

pub struct GitHubGraphQLClient {
	token: Option<String>,
	base_url: String,
	client: reqwest::Client,
}

impl GitHubGraphQLClient {
	pub fn new(token: Option<String>) -> Self {
		Self {
			token,
			base_url: "https://api.github.com/graphql".to_string(),
			client: reqwest::Client::new(),
		}
	}

	pub async fn query<T>(&self, query: &str, variables: Option<Value>) -> Result<T, Box<dyn std::error::Error>>
	where
		T: for<'de> Deserialize<'de>,
	{
		let mut headers = reqwest::header::HeaderMap::new();
		headers.insert("User-Agent", "MalterlibGitHostingProvider".parse()?);

		if let Some(ref token) = self.token {
			headers.insert(
				"Authorization",
				format!("Bearer {}", token).parse()?,
			);
		}

		let mut payload = json!({ "query": query });
		if let Some(vars) = variables {
			payload["variables"] = vars;
		}

		let response = self.client
			.post(&self.base_url)
			.headers(headers)
			.json(&payload)
			.send()
			.await?;

		if !response.status().is_success() {
			let error_text = response.text().await?;
			return Err(format!(
				"GitHub request failed with status {}: {}",
				response.status(),
				error_text
			)
			.into());
		}

		let result: GraphQLResponse<T> = response.json().await?;

		if let Some(errors) = result.errors {
			let error_messages: Vec<String> = errors.iter().map(|e| e.message.clone()).collect();
			return Err(format!("GitHub GraphQL errors: {}", error_messages.join(", ")).into());
		}

		result.data.ok_or_else(|| "GitHub GraphQL response missing data field".into())
	}
}`;

export type FontSize = number;

/**
 * Describes a canonical physical pixel size configuration for an Unbroken font variant.
 */
export interface IPixelPerfectConfig {
	/** Physical pixel height of a character cell */
	readonly physicalHeight: number;
	/** Physical pixel width of a character cell */
	readonly physicalWidth: number;
	/** Which font variant to use */
	readonly fontId: 'standard' | 'retina' | 'unbroken12';
	/** Human-readable font name */
	readonly fontName: string;
	/** Supported style variants */
	readonly variants: readonly string[];
}

/**
 * A computed pixel-perfect font option for a specific DPR.
 */
export interface IPixelPerfectFontOption {
	/** The CSS font size in pixels (may be fractional) */
	readonly cssFontSize: number;
	/** The physical pixel height this maps to */
	readonly physicalHeight: number;
	/** The physical pixel width of a character cell */
	readonly physicalWidth: number;
	/** The CSS character width (physicalWidth / DPR) */
	readonly cssCharWidth: number;
	/** The canonical config this was computed from */
	readonly config: IPixelPerfectConfig;
	/** A human-readable description for the UI */
	readonly description: string;
}

/**
 * The 4 canonical physical pixel sizes from the Unbroken font table.
 */
const CANONICAL_CONFIGS: readonly IPixelPerfectConfig[] = [
	{ physicalHeight: 10, physicalWidth: 6, fontId: 'standard', fontName: 'Unbroken', variants: ['Normal'] },
	{ physicalHeight: 20, physicalWidth: 12, fontId: 'retina', fontName: 'Unbroken Retina', variants: ['Normal', 'Bold'] },
	{ physicalHeight: 24, physicalWidth: 14, fontId: 'unbroken12', fontName: 'Unbroken12 Retina', variants: ['Normal', 'Bold'] },
	{ physicalHeight: 30, physicalWidth: 18, fontId: 'standard', fontName: 'Unbroken', variants: ['Normal'] },
];

/**
 * Extended configs including 2x multiples of retina fonts, used as fallback
 * when canonical configs produce fewer than 2 options for a given DPR.
 */
const EXTENDED_CONFIGS: readonly IPixelPerfectConfig[] = [
	...CANONICAL_CONFIGS,
	// 2x multiples
	{ physicalHeight: 40, physicalWidth: 24, fontId: 'retina', fontName: 'Unbroken Retina', variants: ['Normal', 'Bold'] },
	{ physicalHeight: 48, physicalWidth: 28, fontId: 'unbroken12', fontName: 'Unbroken12 Retina', variants: ['Normal', 'Bold'] },
	// 3x multiples
	{ physicalHeight: 60, physicalWidth: 36, fontId: 'retina', fontName: 'Unbroken Retina', variants: ['Normal', 'Bold'] },
	{ physicalHeight: 72, physicalWidth: 42, fontId: 'unbroken12', fontName: 'Unbroken12 Retina', variants: ['Normal', 'Bold'] },
	// 4x multiples
	{ physicalHeight: 80, physicalWidth: 48, fontId: 'retina', fontName: 'Unbroken Retina', variants: ['Normal', 'Bold'] },
	{ physicalHeight: 96, physicalWidth: 56, fontId: 'unbroken12', fontName: 'Unbroken12 Retina', variants: ['Normal', 'Bold'] },
	// 5x multiples
	{ physicalHeight: 50, physicalWidth: 30, fontId: 'standard', fontName: 'Unbroken', variants: ['Normal'] },
	{ physicalHeight: 100, physicalWidth: 60, fontId: 'retina', fontName: 'Unbroken Retina', variants: ['Normal', 'Bold'] },
	{ physicalHeight: 120, physicalWidth: 70, fontId: 'unbroken12', fontName: 'Unbroken12 Retina', variants: ['Normal', 'Bold'] },
];

const PIXEL_PERFECT_EPSILON = 0.01;
const MIN_CSS_SIZE = 6;
const MAX_CSS_SIZE = 18;

const HUMOROUS_DESCRIPTIONS: { threshold: number; text: string }[] = [
	{ threshold: 12, text: 'I\'m a code-reading machine' },
	{ threshold: 15, text: 'I\'m allergic to my glasses' },
	{ threshold: 20, text: 'My optometrist is worried' },
	{ threshold: 24, text: 'I code from across the room' },
	{ threshold: Infinity, text: 'I\'m blind as a bat' },
];

function computeOptionsFromConfigs(configs: readonly IPixelPerfectConfig[], dpr: number): IPixelPerfectFontOption[] {
	const inRange: IPixelPerfectFontOption[] = [];
	const aboveRange: IPixelPerfectFontOption[] = [];

	for (const config of configs) {
		const cssSize = config.physicalHeight / dpr;

		// Round-trip check: does cssSize * dpr give back the physical height?
		if (Math.abs(cssSize * dpr - config.physicalHeight) > PIXEL_PERFECT_EPSILON) {
			continue;
		}

		// Below minimum is always excluded
		if (cssSize < MIN_CSS_SIZE) {
			continue;
		}

		const option: IPixelPerfectFontOption = {
			cssFontSize: cssSize,
			physicalHeight: config.physicalHeight,
			physicalWidth: config.physicalWidth,
			cssCharWidth: config.physicalWidth / dpr,
			config,
			description: '', // assigned below
		};

		if (cssSize <= MAX_CSS_SIZE) {
			inRange.push(option);
		} else {
			aboveRange.push(option);
		}
	}

	// Start with in-range options, then add above-range (sorted by size) until we have at least 3
	aboveRange.sort((a, b) => a.cssFontSize - b.cssFontSize);
	const options = [...inRange];
	if (options.length < 3) {
		for (const opt of aboveRange) {
			options.push(opt);
			if (options.length >= 3) {
				break;
			}
		}
	}

	// Sort by CSS size ascending
	options.sort((a, b) => a.cssFontSize - b.cssFontSize);

	// Assign descriptions based on CSS size thresholds
	for (const option of options) {
		for (const desc of HUMOROUS_DESCRIPTIONS) {
			if (option.cssFontSize < desc.threshold) {
				(option as { description: string }).description = desc.text;
				break;
			}
		}
	}

	return options;
}

/**
 * Returns pixel-perfect font size options for the given device pixel ratio.
 * Uses the 4 canonical physical pixel sizes, falling back to extended configs
 * if fewer than 2 options are available.
 */
export function getPixelPerfectOptions(dpr: number): IPixelPerfectFontOption[] {
	return computeOptionsFromConfigs(EXTENDED_CONFIGS, dpr);
}

/**
 * Checks if a DPR value is a dyadic rational (exactly representable in binary floating-point).
 * Non-dyadic DPRs like 1.3 cause sub-pixel rendering artifacts.
 * Dyadic rationals include: 1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 3.0, etc.
 */
export function isDyadicRational(dpr: number): boolean {
	for (let n = 0; n <= 8; n++) {
		const scaled = dpr * (1 << n);
		if (Math.abs(scaled - Math.round(scaled)) < 0.001) {
			return true;
		}
	}
	return false;
}

/**
 * Checks if the screen resolution is an integer fraction of the native display resolution.
 * That is, nativeWidth / screenWidth === nativeHeight / screenHeight === some positive integer k.
 */
export function isIntegerFractionOfNative(screenWidth: number, screenHeight: number, nativeWidth: number, nativeHeight: number): boolean {
	const kw = nativeWidth / screenWidth;
	const kh = nativeHeight / screenHeight;
	if (kw < 1 || kh < 1) {
		return false;
	}
	if (Math.abs(kw - Math.round(kw)) > 0.01) {
		return false;
	}
	if (Math.abs(kh - Math.round(kh)) > 0.01) {
		return false;
	}
	if (Math.abs(kw - kh) > 0.01) {
		return false;
	}
	return true;
}

/**
 * Resolves the CSS font-family string for a given font option at a given DPR.
 *
 * Accounts for the UnbrokenEmbedded CSS @font-face auto-switch behavior:
 * - At DPR >= 2: UnbrokenEmbedded resolves to Retina variant
 * - At DPR < 2: UnbrokenEmbedded resolves to Standard variant
 *
 * Returns `undefined` when the default font family (UnbrokenEmbedded) already
 * provides the correct variant, so no override is needed.
 */
export function resolveFontFamily(option: IPixelPerfectFontOption, dpr: number): string | undefined {
	const isHighDpi = dpr >= 2;

	switch (option.config.fontId) {
		case 'unbroken12':
			return 'Unbroken12Embedded, \'Unbroken Retina\', Unbroken, Menlo, Monaco, \'Courier New\', monospace';
		case 'retina':
			if (isHighDpi) {
				// Auto-switch already gives retina at DPR >= 2
				return undefined;
			}
			// Force retina at DPR < 2
			return 'Unbroken10RetinaEmbedded, \'Unbroken Retina\', Unbroken, Menlo, Monaco, \'Courier New\', monospace';
		case 'standard':
			if (!isHighDpi) {
				// Auto-switch already gives standard at DPR < 2
				return undefined;
			}
			// Force standard at DPR >= 2 (prevent auto-retina)
			return 'Unbroken10Embedded, \'Unbroken Retina\', Unbroken, Menlo, Monaco, \'Courier New\', monospace';
	}
}

/**
 * Formats a CSS font size for display in the UI.
 * Shows as integer when close to one, otherwise rounds to 2 decimal places.
 */
export function formatCssFontSize(cssSize: number): string {
	const rounded = Math.round(cssSize);
	if (Math.abs(cssSize - rounded) < PIXEL_PERFECT_EPSILON) {
		return `${rounded}px`;
	}
	// Round to 2 decimal places, strip trailing zeros
	const formatted = (Math.round(cssSize * 100) / 100).toString();
	return `${formatted}px`;
}
