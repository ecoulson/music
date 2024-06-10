fn main() -> Result<(), Box<dyn std::error::Error>> {
    tonic_build::configure()
        .type_attribute(".", "#[derive(serde::Serialize, serde::Deserialize)]")
        .compile(
            &["../protos/hub.proto", "../protos/player.proto"],
            &["../protos"],
        )?;

    Ok(())
}
