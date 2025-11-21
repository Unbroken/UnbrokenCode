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

export const FONT_SIZE_OPTIONS = [
	{ size: 10, desc: 'I\'m a code-reading machine' },
	//	{ size: 12, desc: 'I\'m practical, not proud' },
	{ size: 12, desc: 'I\'m allergic to my glasses' },
	{ size: 15, desc: 'I\'m blind as a bat' }
] as const;

export type FontSize = number;
