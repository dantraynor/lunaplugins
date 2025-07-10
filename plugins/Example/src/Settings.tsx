import React from "react";

import { LunaSettings, LunaSwitchSetting } from "@luna/ui";
import { trace } from ".";

export const Settings = () => {
	const [checked, setChecked] = React.useState(false);
	const onChange = React.useCallback((_: React.ChangeEvent<HTMLInputElement>, checked?: boolean) => {
		trace.msg.log(`Example switch is now ${checked ? "on" : "off"}`);
		setChecked(checked ?? false);
	}, []);
	return (
		<LunaSettings>
			<LunaSwitchSetting title="Example Switch" checked={checked} desc="This is an example switch" onChange={onChange} />
		</LunaSettings>
	);
};
